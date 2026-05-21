"use strict";

/*
 * ioBroker.sunseeker
 *
 * Polls device list + per-device status/settings from the Sunseeker cloud
 * (server.sk-robot.com for "Old", wirefree-specific[-us].sk-robot.com for
 * "New" / X / V / S / V1 models) and subscribes to MQTT for realtime push.
 *
 * State tree: json2iob writes the raw API payloads under <sn>.list / .status /
 * .settings / .mqtt. Commands are dispatched via REST when <sn>.remote.* is set.
 */

const utils = require("@iobroker/adapter-core");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const mqtt = require("mqtt");
const Json2iob = require("json2iob");

const URL_OLD = "https://server.sk-robot.com/api";
const HOST_OLD = "server.sk-robot.com";
const URL_XV_EU = "https://wirefree-specific.sk-robot.com/api";
const HOST_XV_EU = "wirefree-specific.sk-robot.com";
const URL_XV_US = "https://wirefree-specific-us.sk-robot.com/api";
const HOST_XV_US = "wirefree-specific-us.sk-robot.com";

const APP_ID = "0123456789abcdef";

const CMDURL_SXV = "/iot_mower/wireless/device/";
const CMDURL_V1 = "/app_wirelessv1_mower/wirelessv1/device/";

const MQTT_OLD_HOST = "mqtts.sk-robot.com";
const MQTT_OLD_PORT = 1883;
const MQTT_OLD_USER = "app";
const MQTT_OLD_PASS = "h4ijwkTnyrA";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0f7mbMVc/YIYQbR8Ty3u
7yx0cKX6Gt7JkVQrWynI7xM6/yVPMC1I7nXdjMlVPpc06UXoc5ClQNsTbQ4vumFg
2RZPQwAOc7yL1Y8t1W0b9jMTztu32ZzlobfzIVkIO1R7x1I+pkyp6QDm/MnvWyeu
CM77gS2bDv47H9COQn/gy/fy9uecyWCY3u+dXQhujLPrSJ2FFs6SwD0t5QEJjdrC
ftkKQFsflm+i5RQZBMNGT3LdAMnPK4avG642Afum0SzmNrEZrIo7pr2w0fvokbWB
SOOeEdGAx7UVI1kHssOohqW37yJzzFMIlahZSEJ0A3Dm6yrtgobp2mQlCisqsVW4
XwIDAQAB
-----END PUBLIC KEY-----`;

const NEW_ACTIONS = {
    start: { cmd: "start", cmdid: "startWork" },
    pause: { cmd: "pause", cmdid: "pauseWork" },
    dock: { cmd: "start_find_charger", cmdid: "startFindCharger" },
    stop_find_charger: { cmd: "stop_find_charger", cmdid: "stopFindCharger" },
    border: { cmd: "follow_border", cmdid: "followBorder" },
    stop: { cmd: "stop", cmdid: "stopWork" },
    stop_task: { cmd: "stop_task", cmdid: "stopTask" },
    restart: { cmd: "restart", cmdid: "restartWork" },
};

const OLD_MODES = { start: 1, pause: 0, dock: 2, border: 4, stop: 4 };
const V1_MODES = { start: 1, pause: 0, dock: 2, border: 4, stop: 4 };

const ERRORTYPE_LABELS = {
    0: "normal",
    2: "Trapped",
    16: "No border",
    32: "Started outside border",
    262144: "Charging power to high",
};

class Sunseeker extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    constructor(options) {
        super({ ...options, name: "sunseeker" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.session = null;
        this.devicesRaw = {};
        this.deviceMeta = {};
        this.pollInterval = undefined;
        this.refreshInterval = undefined;
        this.mqttRetryTimer = undefined;
        this.mqttOldRetryTimer = undefined;
        this.mqttClient = null;
        this.mqttOldClient = null;
        this.mqttPassword = undefined;
        this.unloading = false;
        this.json2iob = new Json2iob(this);
        this.eventCodes = {};
        this.v1EventCodes = {};
    }

    async onReady() {
        this.setState("info.connection", false, true);

        const cfg = this.config;
        if (!cfg.username || !cfg.password) {
            this.log.error("Bitte Benutzername und Passwort in den Adapter-Einstellungen setzen");
            return;
        }
        cfg.region = (cfg.region || "EU").toUpperCase();
        cfg.apptype = cfg.apptype || "New";
        cfg.interval = Number(cfg.interval) > 0 ? Number(cfg.interval) : 300;
        cfg.language = cfg.language || "de-DE";

        this.loadEventCodes(cfg.language);

        this.subscribeStates("*");

        try {
            await this.login();
        } catch (err) {
            this.log.error(`Login fehlgeschlagen: ${err.message}`);
            return;
        }
        this.setState("info.connection", true, true);

        try {
            await this.loadDevices();
        } catch (err) {
            this.log.error(`Geräteliste laden fehlgeschlagen: ${err.message}`);
        }

        await this.updateAllDevices();

        const intervalMs = cfg.interval * 1000;
        this.pollInterval = this.setInterval(() => {
            this.updateAllDevices().catch(err => this.log.warn(`Polling: ${err.message}`));
        }, intervalMs);

        const ttlSec = (this.session && this.session.expires_in ? Number(this.session.expires_in) : 3600) - 60;
        this.refreshInterval = this.setInterval(
            () => {
                this.refreshToken().catch(err => this.log.error(`Token-Refresh: ${err.message}`));
            },
            Math.max(60, ttlSec) * 1000,
        );

        if (cfg.apptype === "New") {
            this.startMqttNew();
        } else {
            this.startMqttOld();
        }
    }

    onUnload(callback) {
        try {
            this.unloading = true;
            if (this.pollInterval) {
                this.clearInterval(this.pollInterval);
            }
            if (this.refreshInterval) {
                this.clearInterval(this.refreshInterval);
            }
            if (this.mqttRetryTimer) {
                this.clearTimeout(this.mqttRetryTimer);
            }
            if (this.mqttOldRetryTimer) {
                this.clearTimeout(this.mqttOldRetryTimer);
            }
            for (const meta of Object.values(this.deviceMeta)) {
                if (meta.refreshTimer) {
                    this.clearTimeout(meta.refreshTimer);
                }
            }
            for (const client of [this.mqttClient, this.mqttOldClient]) {
                if (client) {
                    try {
                        client.end(true);
                    } catch (e) {
                        this.log.debug(`mqtt end error: ${e.message}`);
                    }
                }
            }
            this.mqttClient = null;
            this.mqttOldClient = null;
            this.setState("info.connection", false, true);
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${error.message}`);
            callback();
        }
    }

    loadEventCodes(language) {
        const lang = String(language || "de")
            .toLowerCase()
            .slice(0, 2);
        try {
            const file = path.join(__dirname, "lib", "eventcodes.json");
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            const fallback = "en";
            this.eventCodes = data.events[lang] || data.events[fallback] || {};
            this.v1EventCodes = data.v1Events[lang] || data.v1Events[fallback] || {};
        } catch (err) {
            this.log.debug(`Event-Codes nicht ladbar: ${err.message}`);
            this.eventCodes = {};
            this.v1EventCodes = {};
        }
    }

    statesForDevice(sn) {
        const meta = this.deviceMeta[sn];
        const isV1 = meta && (meta.modelClass === "V1" || this.config.apptype === "Old");
        const events = isV1 ? this.v1EventCodes : this.eventCodes;
        return {
            event_code: { ...events },
            errortype: { ...ERRORTYPE_LABELS },
        };
    }

    /**
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const parts = id.split(".");
        const settingsIdx = parts.indexOf("settings");
        if (settingsIdx > 0 && parts[settingsIdx + 1]) {
            const sn = parts[settingsIdx - 1];
            const leaf = parts[settingsIdx + 1];
            if (leaf === "bladeSpeed" || leaf === "bladeHeight") {
                const key = leaf === "bladeSpeed" ? "speed" : "height";
                try {
                    await this.setBlade(sn, key, Number(state.val));
                    this.setTimeout(() => this.updateDevice(sn).catch(() => {}), 1500);
                    this.setState(id, { val: state.val, ack: true });
                } catch (err) {
                    this.log.error(`Klingen-${key} für ${sn} fehlgeschlagen: ${err.message}`);
                }
                return;
            }
        }
        const remoteIdx = parts.indexOf("remote");
        if (remoteIdx < 0 || remoteIdx + 1 >= parts.length) {
            return;
        }
        const sn = parts[remoteIdx - 1];
        const command = parts[remoteIdx + 1];
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.warn(`onStateChange: Gerät ${sn} unbekannt`);
            return;
        }
        try {
            if (command === "refresh") {
                await this.updateDevice(sn);
            } else {
                await this.sendCommand(sn, command, state.val);
                this.setTimeout(() => this.updateDevice(sn).catch(() => {}), 1500);
            }
            this.setState(id, { val: state.val, ack: true });
        } catch (err) {
            this.log.error(`Befehl ${command} für ${sn} fehlgeschlagen: ${err.message}`);
        }
    }

    // ------------------------------ REST ------------------------------

    getBase() {
        if (this.config.apptype === "Old") {
            return { url: URL_OLD, host: HOST_OLD };
        }
        if (this.config.region === "US") {
            return { url: URL_XV_US, host: HOST_XV_US };
        }
        return { url: URL_XV_EU, host: HOST_XV_EU };
    }

    authHeaders() {
        const base = this.getBase();
        return {
            "Accept-Language": this.config.language,
            Authorization: `bearer ${this.session.access_token}`,
            Host: base.host,
            Connection: "Keep-Alive",
            "User-Agent": "okhttp/4.4.1",
        };
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {Record<string, string>} headers
     * @param {any} [data]
     */
    async request(method, path, headers, data) {
        const base = this.getBase();
        const url = `${base.url}${path}`;
        const res = await axios({
            method,
            url,
            headers,
            data,
            timeout: 15000,
            validateStatus: () => true,
        });
        if (res.status === 401) {
            this.log.warn("HTTP 401 - Token wird erneuert");
            await this.refreshToken();
            throw new Error(`${method} ${path}: 401`);
        }
        if (res.data && typeof res.data === "object") {
            return { status: res.status, json: res.data };
        }
        const preview = typeof res.data === "string" ? res.data.slice(0, 200) : String(res.data);
        throw new Error(`${method} ${path} non-JSON (HTTP ${res.status}): ${preview}`);
    }

    async login() {
        const base = this.getBase();
        const body = new URLSearchParams({
            username: this.config.username,
            password: this.config.password,
            grant_type: "password",
            scope: "server",
        }).toString();
        const res = await axios({
            method: "POST",
            url: `${base.url}/auth/oauth/token`,
            headers: {
                "Accept-Language": this.config.language,
                Authorization: "Basic YXBwOmFwcA==",
                "Content-Type": "application/x-www-form-urlencoded",
                Connection: "Keep-Alive",
                "User-Agent": "okhttp/4.8.1",
            },
            data: body,
            timeout: 15000,
            validateStatus: () => true,
        });
        const json = res.data;
        if (!json || typeof json !== "object" || !json.access_token) {
            throw new Error(`Login: kein access_token (HTTP ${res.status}): ${JSON.stringify(json)}`);
        }
        this.session = json;
        this.log.info(`Login OK user_id=${json.user_id}`);
    }

    async refreshToken() {
        if (!this.session || !this.session.refresh_token) {
            await this.login();
            return;
        }
        const base = this.getBase();
        if (this.config.apptype === "New") {
            const url = `${base.url}/admin/new-oauth/oauth2-new/token?refresh_token=${encodeURIComponent(this.session.refresh_token)}`;
            const res = await axios({
                method: "GET",
                url,
                headers: {
                    Authorization: "Basic YXBwOmFwcA==",
                    "accept-encoding": "gzip",
                    Connection: "Keep-Alive",
                    "User-Agent": "okhttp/4.8.1",
                },
                timeout: 15000,
                validateStatus: () => true,
            });
            const json = res.data;
            if (json && json.access_token) {
                this.session = json;
                this.log.info("Token erneuert (new-oauth)");
                return;
            }
            this.log.warn("Refresh fehlgeschlagen, erneuter Login");
            await this.login();
            return;
        }
        const body = new URLSearchParams({
            refresh_token: this.session.refresh_token,
            grant_type: "refresh_token",
            scope: "server",
        }).toString();
        const res = await axios({
            method: "POST",
            url: `${base.url}/auth/oauth/token`,
            headers: {
                "Accept-Language": this.config.language,
                Authorization: "Basic YXBwOmFwcA==",
                "Content-Type": "application/x-www-form-urlencoded",
                Connection: "Keep-Alive",
                "User-Agent": "okhttp/4.8.1",
            },
            data: body,
            timeout: 15000,
            validateStatus: () => true,
        });
        const json = res.data;
        if (json && json.access_token) {
            this.session = json;
            this.log.info("Token erneuert");
        } else {
            this.log.warn("Refresh fehlgeschlagen, erneuter Login");
            await this.login();
        }
    }

    classifyModel(modelName) {
        if (!modelName) {
            return "S";
        }
        if (/^V18/.test(modelName) || /^V3/.test(modelName)) {
            return "V";
        }
        if (/^V1/.test(modelName)) {
            return "V1";
        }
        if (/^V/.test(modelName)) {
            return "V";
        }
        if (/^X/.test(modelName)) {
            return "X";
        }
        return "S";
    }

    async loadDevices() {
        const path =
            this.config.apptype === "Old"
                ? "/mower/device-user/list"
                : "/app_wireless_mower/device-user/getCustomDevice?all=true";
        const { json } = await this.request("GET", path, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (!Array.isArray(json.data)) {
            this.log.warn(`Geräteliste leer: ${JSON.stringify(json)}`);
            return;
        }
        for (const d of json.data) {
            const sn = d.deviceSn;
            this.devicesRaw[sn] = d;
            this.deviceMeta[sn] = {
                modelClass: this.classifyModel(d.modelName),
                refreshTimer: undefined,
            };
            this.deviceMeta[sn].cmdurl = this.deviceMeta[sn].modelClass === "V1" ? CMDURL_V1 : CMDURL_SXV;

            await this.extendObject(sn, {
                type: "device",
                common: { name: d.deviceName || sn },
                native: {},
            });
            await this.json2iob.parse(`${sn}.list`, d, {
                channelName: "Geräteliste",
                forceIndex: false,
            });
            await this.ensureRemoteButtons(sn);
            this.log.info(`Gerät: sn=${sn} model=${d.modelName} name=${d.deviceName}`);
        }
    }

    async ensureRemoteButtons(sn) {
        await this.extendObject(`${sn}.remote`, {
            type: "channel",
            common: { name: "Befehle" },
            native: {},
        });
        const buttons = [
            ["start", "Mähen starten"],
            ["pause", "Pause"],
            ["dock", "Zur Ladestation"],
            ["stop_find_charger", "Heimfahrt abbrechen"],
            ["border", "Kantenfahrt"],
            ["stop", "Stopp"],
            ["stop_task", "Aufgabe abbrechen"],
            ["restart", "Neustart der Aufgabe"],
            ["refresh", "Status neu laden"],
        ];
        for (const [id, name] of buttons) {
            await this.extendObject(`${sn}.remote.${id}`, {
                type: "state",
                common: {
                    name,
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }
    }

    async updateAllDevices() {
        for (const sn of Object.keys(this.devicesRaw)) {
            try {
                await this.updateDevice(sn);
            } catch (err) {
                this.log.warn(`Update ${sn}: ${err.message}`);
            }
        }
    }

    async updateDevice(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        const statusPath =
            this.config.apptype === "Old"
                ? `/mower/device/getBysn?sn=${encodeURIComponent(sn)}`
                : `/app_wireless_mower/device/getBysn?sn=${encodeURIComponent(sn)}`;
        const settingsPath =
            this.config.apptype === "Old"
                ? `/mower/device-setting/${encodeURIComponent(sn)}`
                : `/app_wireless_mower/device/info/${encodeURIComponent(dev.deviceId)}`;

        const states = this.statesForDevice(sn);
        const status = await this.request("GET", statusPath, this.authHeaders());
        if (status.json && status.json.data) {
            await this.json2iob.parse(`${sn}.status`, status.json.data, {
                channelName: "Status",
                forceIndex: false,
                states,
            });
        }
        const settings = await this.request("GET", settingsPath, this.authHeaders());
        if (settings.json && settings.json.data) {
            await this.json2iob.parse(`${sn}.settings`, settings.json.data, {
                channelName: "Einstellungen",
                forceIndex: false,
                states,
            });
            await this.ensureBladeWritable(sn, settings.json.data);
        }
    }

    /**
     * @param {string} sn
     * @param {Record<string, any>} settingsData
     */
    async ensureBladeWritable(sn, settingsData) {
        if (this.config.apptype === "Old") {
            return;
        }
        if (settingsData && Object.prototype.hasOwnProperty.call(settingsData, "bladeSpeed")) {
            await this.extendObject(`${sn}.settings.bladeSpeed`, {
                type: "state",
                common: {
                    name: "Klingen-Drehzahl",
                    type: "number",
                    role: "level",
                    min: 2800,
                    max: 3000,
                    step: 100,
                    unit: "rpm",
                    read: true,
                    write: true,
                },
                native: {},
            });
        }
        if (settingsData && Object.prototype.hasOwnProperty.call(settingsData, "bladeHeight")) {
            await this.extendObject(`${sn}.settings.bladeHeight`, {
                type: "state",
                common: {
                    name: "Schnitthöhe",
                    type: "number",
                    role: "level",
                    min: 20,
                    max: 100,
                    step: 5,
                    unit: "mm",
                    read: true,
                    write: true,
                },
                native: {},
            });
        }
    }

    // ------------------------------ Commands ------------------------------

    async sendCommand(sn, command, value) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (this.config.apptype === "Old") {
            return this.sendCommandOld(dev, command);
        }
        if (meta.modelClass === "V1") {
            return this.sendCommandV1(dev, meta, command);
        }
        return this.sendCommandNew(dev, meta, command, value);
    }

    async sendCommandNew(dev, meta, command, value) {
        const action = NEW_ACTIONS[command];
        if (!action) {
            throw new Error(`Unbekannter Befehl: ${command}`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            cmd: action.cmd,
            deviceSn: dev.deviceSn,
            id: action.cmdid,
            method: "action",
        };
        if (command === "border" && meta.modelClass === "V") {
            data.value = true;
        }
        if (command === "start" && value && typeof value !== "boolean") {
            data.work_id = value;
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}action`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    }

    async sendCommandV1(dev, meta, command) {
        const mode = V1_MODES[command];
        if (mode === undefined) {
            throw new Error(`V1: Befehl ${command} nicht unterstützt`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            method: "setWorkStatus",
            mode,
        };
        const res = await this.request(
            "POST",
            `${meta.cmdurl}setProperty`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    }

    async sendCommandOld(dev, command) {
        const mode = OLD_MODES[command];
        if (mode === undefined) {
            throw new Error(`Old: Befehl ${command} nicht unterstützt`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            mode,
        };
        const res = await this.request(
            "POST",
            "/app_mower/device/setWorkStatus",
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    }

    /**
     * @param {string} sn
     * @param {"speed"|"height"} key
     * @param {number} value
     */
    async setBlade(sn, key, value) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        if (this.config.apptype === "Old") {
            throw new Error("Klingen-Steuerung wird für Alt-API nicht unterstützt");
        }
        const intVal = Math.round(Number(value));
        if (!Number.isFinite(intVal)) {
            throw new Error(`Ungültiger Wert: ${value}`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            id: "setDevBlade",
            key: "blade",
            method: "set_property",
            [key]: intVal,
        };
        const endpoint = meta.modelClass === "V1" ? "setProperty" : "set_property";
        const res = await this.request(
            "POST",
            `${meta.cmdurl}${endpoint}`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    }

    // ------------------------------ MQTT (New API only) ------------------------------

    encryptRsa(plaintext) {
        const buf = crypto.publicEncrypt(
            { key: PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
            Buffer.from(plaintext, "utf8"),
        );
        return buf.toString("base64");
    }

    randomMqttPassword() {
        return crypto.randomBytes(16).toString("hex").slice(0, 24);
    }

    mqttBroker() {
        const first = Object.values(this.deviceMeta)[0];
        const v1 = first && first.modelClass === "V1";
        if (this.config.region === "US") {
            return v1
                ? { host: "app.mqttv1-us.sk-robot.com", port: 32884 }
                : { host: "wfsmqtt-specific-us.sk-robot.com", port: 1884 };
        }
        return v1
            ? { host: "app.mqttv1-eu.sk-robot.com", port: 32884 }
            : { host: "wfsmqtt-specific.sk-robot.com", port: 1884 };
    }

    async editMqttPassword() {
        this.mqttPassword = this.randomMqttPassword();
        const encrypted = this.encryptRsa(this.mqttPassword);
        const res = await this.request(
            "PUT",
            "/admin/user/edit",
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify({
                appIdCode: APP_ID,
                appType: 2,
                mqttsPassword: encrypted,
                operatingSystemCode: "android",
            }),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`MQTT-Passwort: ${res.json.msg}`);
        }
    }

    async startMqttNew() {
        if (this.unloading) {
            return;
        }
        try {
            await this.editMqttPassword();
        } catch (err) {
            this.log.error(`MQTT-Passwort setzen fehlgeschlagen: ${err.message}`);
            return;
        }
        this.connectMqtt();
    }

    connectMqtt() {
        if (this.mqttClient) {
            try {
                this.mqttClient.end(true);
            } catch {
                /* ignore */
            }
            this.mqttClient = null;
        }
        const broker = this.mqttBroker();
        const url = `mqtts://${broker.host}:${broker.port}`;
        const username = `${this.session.username || this.config.username}${APP_ID}`;
        const clientId = `${crypto.randomUUID()}new`;
        this.log.info(`MQTT verbinde ${url} username=${username}`);
        const client = mqtt.connect(url, {
            clientId,
            username,
            password: this.mqttPassword,
            protocolVersion: 4,
            keepalive: 60,
            clean: true,
            reconnectPeriod: 0,
            connectTimeout: 15000,
            rejectUnauthorized: true,
        });
        this.mqttClient = client;

        client.on("connect", () => {
            this.log.info("MQTT verbunden");
            this.setState("info.connection", true, true);
            const userId = this.session.user_id;
            const topics = [`/wirelessdevice/${userId}/get`, `/wirelessmower/${userId}/get`];
            for (const t of topics) {
                client.subscribe(t, { qos: 0 }, (err, granted) => {
                    if (err) {
                        this.log.error(`MQTT subscribe ${t}: ${err.message}`);
                    } else {
                        this.log.debug(`MQTT subscribed: ${JSON.stringify(granted)}`);
                    }
                });
            }
            this.fetchInitialProperties().catch(err => this.log.debug(`Initial-Properties: ${err.message}`));
        });

        client.on("message", (topic, payload) => this.onMqttMessage(topic, payload));

        client.on("error", err => {
            this.log.warn(`MQTT error: ${err.message}`);
            const code = /** @type {any} */ (err).code;
            if (code === 4 || code === 5 || /not authorized|bad user/i.test(err.message)) {
                this.scheduleMqttRetry();
            }
        });

        client.on("close", () => {
            this.log.debug("MQTT geschlossen");
            if (!this.unloading) {
                this.scheduleMqttRetry();
            }
        });
    }

    scheduleMqttRetry() {
        if (this.unloading || this.mqttRetryTimer) {
            return;
        }
        this.mqttRetryTimer = this.setTimeout(() => {
            this.mqttRetryTimer = undefined;
            this.startMqttNew().catch(err => this.log.error(`MQTT-Reconnect: ${err.message}`));
        }, 30000);
    }

    onMqttMessage(topic, payload) {
        let data;
        try {
            data = JSON.parse(payload.toString("utf8"));
        } catch {
            this.log.debug(`MQTT non-JSON: ${payload.toString("utf8").slice(0, 200)}`);
            return;
        }
        const sn = data.deviceSn;
        if (!sn || !this.devicesRaw[sn]) {
            this.log.debug(`MQTT für unbekanntes Gerät: ${topic} ${JSON.stringify(data).slice(0, 120)}`);
            return;
        }
        const statusData = data.data && typeof data.data === "object" ? data.data : data;
        this.json2iob.parse(`${sn}.status`, statusData, {
            channelName: "Status",
            forceIndex: false,
            states: this.statesForDevice(sn),
        });
        const meta = this.deviceMeta[sn];
        if (meta.refreshTimer) {
            this.clearTimeout(meta.refreshTimer);
        }
        meta.refreshTimer = this.setTimeout(() => {
            meta.refreshTimer = undefined;
            this.updateDevice(sn).catch(err => this.log.debug(`Refresh nach MQTT (${sn}): ${err.message}`));
        }, 1500);
    }

    // ------------------------------ MQTT (Old API) ------------------------------

    startMqttOld() {
        if (this.unloading) {
            return;
        }
        if (this.mqttOldClient) {
            try {
                this.mqttOldClient.end(true);
            } catch {
                /* ignore */
            }
            this.mqttOldClient = null;
        }
        const url = `mqtt://${MQTT_OLD_HOST}:${MQTT_OLD_PORT}`;
        const userId = this.session.user_id;
        this.log.info(`MQTT (Old) verbinde ${url}`);
        const client = mqtt.connect(url, {
            username: MQTT_OLD_USER,
            password: MQTT_OLD_PASS,
            clientId: `${crypto.randomUUID()}old`,
            protocolVersion: 4,
            keepalive: 60,
            clean: true,
            reconnectPeriod: 0,
            connectTimeout: 15000,
        });
        this.mqttOldClient = client;
        client.on("connect", () => {
            this.log.info("MQTT (Old) verbunden");
            const topic = `/app/${userId}/get`;
            client.subscribe(topic, { qos: 0 }, err => {
                if (err) {
                    this.log.error(`MQTT (Old) subscribe ${topic}: ${err.message}`);
                }
            });
        });
        client.on("message", (topic, payload) => this.onMqttMessage(topic, payload));
        client.on("error", err => this.log.warn(`MQTT (Old) error: ${err.message}`));
        client.on("close", () => {
            this.log.debug("MQTT (Old) geschlossen");
            if (!this.unloading && !this.mqttOldRetryTimer) {
                this.mqttOldRetryTimer = this.setTimeout(() => {
                    this.mqttOldRetryTimer = undefined;
                    this.startMqttOld();
                }, 30000);
            }
        });
    }

    // ------------------------------ Post-MQTT property requests (New) ------------------------------

    async getDeviceProperty(sn, body) {
        const meta = this.deviceMeta[sn];
        const dev = this.devicesRaw[sn];
        if (!meta || !dev) {
            return;
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: sn,
            method: "get_property",
            ...body,
        };
        try {
            await this.request(
                "POST",
                `${meta.cmdurl}get_property`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
        } catch (err) {
            this.log.debug(`get_property ${body.id} (${sn}): ${err.message}`);
        }
    }

    async fetchInitialProperties() {
        for (const sn of Object.keys(this.deviceMeta)) {
            const meta = this.deviceMeta[sn];
            const cls = meta.modelClass;
            if (cls === "V1") {
                continue;
            }
            await this.getDeviceProperty(sn, {
                id: "getDevAllProperties",
                key: "all_property",
            });
            await this.getDeviceProperty(sn, {
                id: "getSelectRegionID",
                key: "region",
            });
            if (cls === "S" || cls === "X") {
                await this.getDeviceProperty(sn, {
                    id: "getAllPath",
                    key: "all_path",
                    map_file: `Wireless_${sn}.json`,
                });
            }
            if (cls === "V") {
                await this.getDeviceProperty(sn, {
                    id: "getConsumableItems",
                    key: "consumable_items",
                });
                await this.getDeviceProperty(sn, {
                    id: "getFcState",
                    key: "fc_state",
                });
            }
        }
    }
}

if (require.main !== module) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    module.exports = options => new Sunseeker(options);
} else {
    new Sunseeker();
}
