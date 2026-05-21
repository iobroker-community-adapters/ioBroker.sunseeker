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
const { Writable } = require("node:stream");
const axios = require("axios");
const mqtt = require("mqtt");
const Json2iob = require("json2iob");
const PImage = require("pureimage");

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
        const scheduleIdx = parts.indexOf("schedule");
        if (scheduleIdx > 0 && parts[scheduleIdx + 1]) {
            const sn = parts[scheduleIdx - 1];
            const leaf = parts[scheduleIdx + 1];
            if (leaf === "set") {
                try {
                    await this.setSchedule(sn);
                    this.setTimeout(() => this.updateDevice(sn).catch(() => {}), 1500);
                    this.setState(id, { val: false, ack: true });
                } catch (err) {
                    this.log.error(`Zeitplan für ${sn} fehlgeschlagen: ${err.message}`);
                }
                return;
            }
            this.setState(id, { val: state.val, ack: true });
            return;
        }
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
            if (leaf === "rainFlag" || leaf === "rainDelayDuration") {
                try {
                    const flagVal =
                        leaf === "rainFlag" ? state.val : (await this.getStateAsync(`${sn}.settings.rainFlag`))?.val;
                    const durVal =
                        leaf === "rainDelayDuration"
                            ? state.val
                            : (await this.getStateAsync(`${sn}.settings.rainDelayDuration`))?.val;
                    await this.setRain(sn, Boolean(flagVal), Math.round(Number(durVal) || 0));
                    this.setTimeout(() => this.updateDevice(sn).catch(() => {}), 1500);
                    this.setState(id, { val: state.val, ack: true });
                } catch (err) {
                    this.log.error(`Regenverzögerung für ${sn} fehlgeschlagen: ${err.message}`);
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
        this.log.debug(`HTTP ${method} ${path}`);
        const res = await axios({
            method,
            url,
            headers,
            data,
            timeout: 15000,
            validateStatus: () => true,
        });
        this.log.debug(`HTTP ${method} ${path} -> ${res.status}`);
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
        this.log.debug(`loadDevices: ${path}`);
        const { json } = await this.request("GET", path, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (!Array.isArray(json.data)) {
            this.log.warn(`Geräteliste leer: ${JSON.stringify(json)}`);
            return;
        }
        this.log.debug(`loadDevices: ${json.data.length} Gerät(e) gefunden`);
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
            await this.delObjectAsync(`${sn}.list`, { recursive: true }).catch(() => {});
            await this.json2iob.parse(`${sn}.general`, d, {
                channelName: "Allgemein",
                forceIndex: false,
            });
            await this.ensureRemoteButtons(sn);
            await this.ensureScheduleStates(sn);
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

    async ensureScheduleStates(sn) {
        await this.extendObject(`${sn}.schedule`, {
            type: "channel",
            common: { name: "Zeitplan" },
            native: {},
        });
        const days = [
            ["monday", "Montag"],
            ["tuesday", "Dienstag"],
            ["wednesday", "Mittwoch"],
            ["thursday", "Donnerstag"],
            ["friday", "Freitag"],
            ["saturday", "Samstag"],
            ["sunday", "Sonntag"],
        ];
        for (const [key, label] of days) {
            await this.extendObject(`${sn}.schedule.${key}`, {
                type: "state",
                common: {
                    name: `${label} (HH:MM-HH:MM, leer = aus)`,
                    type: "string",
                    role: "text",
                    read: true,
                    write: true,
                    def: "",
                },
                native: {},
            });
        }
        await this.extendObject(`${sn}.schedule.pause`, {
            type: "state",
            common: {
                name: "Zeitplan pausiert",
                type: "boolean",
                role: "switch",
                read: true,
                write: true,
                def: false,
            },
            native: {},
        });
        await this.extendObject(`${sn}.schedule.set`, {
            type: "state",
            common: {
                name: "Zeitplan senden",
                type: "boolean",
                role: "button",
                read: false,
                write: true,
                def: false,
            },
            native: {},
        });
    }

    async updateAllDevices() {
        const sns = Object.keys(this.devicesRaw);
        this.log.debug(`updateAllDevices: ${sns.length} Gerät(e)`);
        for (const sn of sns) {
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
        this.log.debug(`updateDevice ${sn}: Status + Einstellungen abrufen`);
        const statusPath =
            this.config.apptype === "Old"
                ? `/mower/device/getBysn?sn=${encodeURIComponent(sn)}`
                : `/app_wireless_mower/device/getBysn?sn=${encodeURIComponent(sn)}`;
        const settingsPath =
            this.config.apptype === "Old"
                ? `/mower/device-setting/${encodeURIComponent(sn)}`
                : `/app_wireless_mower/device-setting/${encodeURIComponent(sn)}`;

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
        if (this.config.apptype !== "Old") {
            const meta = this.deviceMeta[sn];
            if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                await this.fetchMap(sn).catch(err => this.log.debug(`Map ${sn}: ${err.message}`));
            }
        }
    }

    /**
     * @param {string} sn
     * @param {Record<string, any>} settingsData
     */
    async ensureBladeWritable(sn, settingsData) {
        if (!settingsData) {
            return;
        }
        if (this.config.apptype !== "Old") {
            if (Object.prototype.hasOwnProperty.call(settingsData, "bladeSpeed")) {
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
            if (Object.prototype.hasOwnProperty.call(settingsData, "bladeHeight")) {
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
        if (Object.prototype.hasOwnProperty.call(settingsData, "rainFlag")) {
            await this.extendObject(`${sn}.settings.rainFlag`, {
                type: "state",
                common: {
                    name: "Regenverzögerung aktiv",
                    type: "boolean",
                    role: "switch",
                    read: true,
                    write: true,
                },
                native: {},
            });
        }
        if (Object.prototype.hasOwnProperty.call(settingsData, "rainDelayDuration")) {
            await this.extendObject(`${sn}.settings.rainDelayDuration`, {
                type: "state",
                common: {
                    name: "Regenverzögerung Dauer",
                    type: "number",
                    role: "level",
                    min: 0,
                    max: 720,
                    step: 1,
                    unit: "min",
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

    /**
     * @param {string} sn
     * @param {boolean} flag
     * @param {number} durationMin
     */
    async setRain(sn, flag, durationMin) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        const duration = Math.max(0, Math.min(720, Math.round(durationMin)));
        const appId = String(dev.appUserId || this.session.user_id);

        if (this.config.apptype === "Old") {
            const res = await this.request(
                "POST",
                `/app_mower/device/setRain/${encodeURIComponent(sn)}/${appId}`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    rainDelayDuration: duration,
                    rainFlag: flag,
                }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        if (meta.modelClass === "V1") {
            const res = await this.request(
                "POST",
                `${meta.cmdurl}setProperty`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    method: "setRain",
                    rainDelayDuration: duration,
                    rainFlag: flag,
                }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        const res = await this.request(
            "POST",
            `${meta.cmdurl}set_property`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify({
                appId,
                deviceSn: sn,
                id: "setDevRain",
                key: "rain",
                method: "set_property",
                rain_flag: flag,
                delay: duration,
            }),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    }

    /**
     * @param {string} value
     * @returns {{startSec: number, endSec: number} | null}
     */
    parseScheduleDay(value) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
            return null;
        }
        const m = trimmed.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!m) {
            throw new Error(`Format "HH:MM-HH:MM" erwartet, war: "${trimmed}"`);
        }
        const sh = Number(m[1]);
        const sm = Number(m[2]);
        const eh = Number(m[3]);
        const em = Number(m[4]);
        if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
            throw new Error(`Ungültige Uhrzeit: "${trimmed}"`);
        }
        return { startSec: sh * 3600 + sm * 60, endSec: eh * 3600 + em * 60 };
    }

    /**
     * @param {number} sec
     */
    secToHms(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    }

    /**
     * @param {string} sn
     */
    async setSchedule(sn) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        const parsed = [];
        for (let i = 0; i < days.length; i++) {
            const st = await this.getStateAsync(`${sn}.schedule.${days[i]}`);
            const window = this.parseScheduleDay(st && st.val ? String(st.val) : "");
            parsed.push({ dayIndex: i + 1, key: days[i], window });
        }
        const pauseSt = await this.getStateAsync(`${sn}.schedule.pause`);
        const pause = !!(pauseSt && pauseSt.val);
        const appId = String(dev.appUserId || this.session.user_id);

        if (this.config.apptype === "Old") {
            const bos = parsed.map(p => ({
                dayOfWeek: p.dayIndex,
                startAt: p.window ? this.secToHms(p.window.startSec) : "00:00:00",
                endAt: p.window ? this.secToHms(p.window.endSec) : "00:00:00",
                trimFlag: !!p.window,
            }));
            const res = await this.request(
                "POST",
                "/app_mower/device-schedule/setScheduling",
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({ appId, autoFlag: !pause, deviceScheduleBOS: bos, deviceSn: sn }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        if (meta.modelClass === "V1") {
            const bos = [];
            for (const p of parsed) {
                if (!p.window) {
                    continue;
                }
                bos.push({
                    dayOfWeek: p.dayIndex,
                    startAt: this.secToHms(p.window.startSec),
                    endAt: this.secToHms(p.window.endSec),
                    trimFlag: true,
                });
            }
            const res = await this.request(
                "POST",
                `${meta.cmdurl}setProperty`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    autoFlag: !pause,
                    method: "setSchedule",
                    deviceScheduleBOS: bos,
                    pause,
                }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        // S/X/V — set_property time_tactics. Mon=1..Sat=6, Sun=0
        const dayPeriod = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
        const time = [];
        for (const p of parsed) {
            if (!p.window) {
                continue;
            }
            time.push({
                unlock: true,
                period: [dayPeriod[p.key]],
                start: p.window.startSec,
                active: true,
                end: p.window.endSec,
                need_fllow_boader: false,
            });
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}set_property`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify({
                appId,
                deviceSn: sn,
                id: "setTimeTactics",
                key: "time_tactics",
                method: "set_property",
                time,
                time_custom_flag: true,
                recommended_time_flag: false,
                time_zone: 3600,
                pause,
            }),
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
        this.log.debug(`MQTT ${sn} ${topic}: ${JSON.stringify(data).length} Bytes`);
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
        const sns = Object.keys(this.deviceMeta);
        this.log.debug(`fetchInitialProperties: ${sns.length} Gerät(e)`);
        for (const sn of sns) {
            const meta = this.deviceMeta[sn];
            const cls = meta.modelClass;
            if (cls === "V1") {
                continue;
            }
            if (cls === "S" || cls === "X") {
                await this.fetchMap(sn).catch(err => this.log.debug(`Map ${sn}: ${err.message}`));
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
                const mapid = meta.mapid || 0;
                const mapFile = mapid ? `Wireless_${sn}_${mapid}.json` : `Wireless_${sn}.json`;
                await this.getDeviceProperty(sn, {
                    id: "getAllPath",
                    key: "all_path",
                    map_file: mapFile,
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

    /**
     * @param {string} sn
     */
    async fetchMap(sn) {
        if (this.config.apptype === "Old") {
            return;
        }
        const meta = this.deviceMeta[sn];
        if (!meta || (meta.modelClass !== "S" && meta.modelClass !== "X")) {
            this.log.debug(`fetchMap ${sn}: Modellklasse ${meta && meta.modelClass} ohne Karte, übersprungen`);
            return;
        }
        if (meta.mapInFlight) {
            this.log.debug(`fetchMap ${sn}: läuft bereits`);
            return;
        }
        meta.mapInFlight = true;
        this.log.debug(`fetchMap ${sn}: Karteninfo abrufen`);
        try {
            const info = await this.request(
                "GET",
                `/wireless_map/wireless_device/get?deviceSn=${encodeURIComponent(sn)}`,
                this.authHeaders(),
            );
            const data = info.json && info.json.data;
            if (!data) {
                this.log.debug(`fetchMap ${sn}: keine map.info Daten`);
                return;
            }
            await this.json2iob.parse(`${sn}.map.info`, data, {
                channelName: "Karte",
                forceIndex: false,
            });
            const newMapId = data.mapModifyTime;
            if (newMapId !== undefined && newMapId === meta.mapid) {
                this.log.debug(`fetchMap ${sn}: mapModifyTime ${newMapId} unverändert, kein Re-Download`);
                return;
            }
            if (newMapId !== undefined) {
                this.log.debug(`fetchMap ${sn}: mapModifyTime ${meta.mapid || "?"} -> ${newMapId}`);
                meta.mapid = newMapId;
            }

            const heat = await this.request(
                "GET",
                `/wireless_map/wireless_device/getHeatMap?deviceSn=${encodeURIComponent(sn)}`,
                this.authHeaders(),
            );
            const heatData = heat.json && heat.json.data;
            if (heatData) {
                this.log.debug(
                    `fetchMap ${sn}: heatmap urls image=${!!heatData.url} wifi=${!!heatData.wifiUrl} net=${!!heatData.netUrl} texture=${!!heatData.textureUrl}`,
                );
                await this.fetchMapImage(sn, "image", heatData.url);
                await this.fetchMapImage(sn, "wifi", heatData.wifiUrl);
                await this.fetchMapImage(sn, "net", heatData.netUrl);
                await this.fetchMapImage(sn, "texture", heatData.textureUrl);
            }
            const mapJson = await this.fetchMapJson(sn, "mapData", data.mapPathFileUrl);
            const pathJson = await this.fetchMapJson(sn, "pathData", data.realPathFileUlr || data.realPathFileUrl);
            try {
                this.log.debug(`fetchMap ${sn}: Livemap rendern (mapData=${!!mapJson} pathData=${!!pathJson})`);
                const dataUrl = await this.renderLivemap(mapJson, pathJson);
                if (dataUrl) {
                    await this.extendObject(`${sn}.map.livemap`, {
                        type: "state",
                        common: {
                            name: "Livemap (gerenderter PNG data URL)",
                            type: "string",
                            role: "value",
                            read: true,
                            write: false,
                        },
                        native: {},
                    });
                    this.setState(`${sn}.map.livemap`, dataUrl, true);
                    this.log.debug(`fetchMap ${sn}: Livemap geschrieben (${dataUrl.length} Bytes data URL)`);
                } else {
                    this.log.debug(`fetchMap ${sn}: Livemap nicht gerendert (keine Geometrie)`);
                }
            } catch (err) {
                this.log.debug(`Livemap render ${sn}: ${err.message}`);
            }
            const backup = await this.request(
                "GET",
                `/wireless_map/backup_map/get?sn=${encodeURIComponent(sn)}`,
                this.authHeaders(),
            );
            if (backup.json && backup.json.data) {
                await this.extendObject(`${sn}.map.backup`, {
                    type: "state",
                    common: {
                        name: "Backup-Karte (JSON)",
                        type: "string",
                        role: "json",
                        read: true,
                        write: false,
                    },
                    native: {},
                });
                this.setState(`${sn}.map.backup`, JSON.stringify(backup.json.data), true);
                this.log.debug(`fetchMap ${sn}: Backup-Karte geschrieben`);
            }
        } finally {
            meta.mapInFlight = false;
        }
    }

    /**
     * @param {string} sn
     * @param {string} name
     * @param {string} url
     * @returns {Promise<any>}
     */
    async fetchMapJson(sn, name, url) {
        if (!url) {
            this.log.debug(`fetchMapJson ${sn}/${name}: keine URL`);
            return null;
        }
        this.log.debug(`fetchMapJson ${sn}/${name}: GET ${String(url).slice(0, 120)}`);
        const res = await axios.get(url, { timeout: 30000, validateStatus: () => true });
        if (res.status !== 200 || res.data == null) {
            this.log.debug(`fetchMapJson ${sn}/${name}: HTTP ${res.status} leer`);
            return null;
        }
        let parsed;
        let payload;
        if (typeof res.data === "string") {
            payload = res.data;
            try {
                parsed = JSON.parse(res.data);
            } catch {
                parsed = null;
            }
        } else {
            parsed = res.data;
            payload = JSON.stringify(res.data);
        }
        await this.extendObject(`${sn}.map.${name}`, {
            type: "state",
            common: {
                name: `Karten-${name} (JSON)`,
                type: "string",
                role: "json",
                read: true,
                write: false,
            },
            native: {},
        });
        this.setState(`${sn}.map.${name}`, payload, true);
        this.log.debug(`fetchMapJson ${sn}/${name}: ${payload.length} Bytes geschrieben`);
        return parsed;
    }

    /**
     * Render a livemap (map polygons + recorded path + charger position) into a PNG data URL.
     *
     * @param {any} mapData parsed JSON of /wireless_map/wireless_device/get -> mapPathFileUrl
     * @param {any} pathData parsed JSON of /wireless_map/wireless_device/get -> realPathFileUlr (array of [x,y,code])
     * @returns {Promise<string|null>}
     */
    async renderLivemap(mapData, pathData) {
        if (!mapData || typeof mapData !== "object") {
            return null;
        }
        const origWarn = console.warn;
        console.warn = (...args) => {
            if (typeof args[0] === "string" && args[0].startsWith("can't project the same paths")) {
                return;
            }
            origWarn(...args);
        };
        try {
            return await this.renderLivemapInner(mapData, pathData);
        } finally {
            console.warn = origWarn;
        }
    }

    /**
     * @param {any} mapData parsed mapData JSON
     * @param {any} pathData parsed pathData JSON
     * @returns {Promise<string|null>}
     */
    async renderLivemapInner(mapData, pathData) {
        const parsePoints = str => {
            if (!str) {
                return [];
            }
            try {
                const arr = typeof str === "string" ? JSON.parse(str) : str;
                if (!Array.isArray(arr)) {
                    return [];
                }
                return arr
                    .map(p => [Number(p[0]), Number(p[1])])
                    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
            } catch {
                return [];
            }
        };
        const groups = [
            "divide_area_work",
            "region_work",
            "region_channel",
            "region_obstacle",
            "region_forbidden",
            "region_placed_blank",
            "region_charger_channel",
        ];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const collected = {};
        for (const g of groups) {
            const arr = Array.isArray(mapData[g]) ? mapData[g] : [];
            collected[g] = arr.map(item => parsePoints(item.points)).filter(p => p.length > 0);
            for (const pts of collected[g]) {
                for (const [x, y] of pts) {
                    if (x < minX) {
                        minX = x;
                    }
                    if (x > maxX) {
                        maxX = x;
                    }
                    if (y < minY) {
                        minY = y;
                    }
                    if (y > maxY) {
                        maxY = y;
                    }
                }
            }
        }
        if (!Number.isFinite(minX) || maxX === minX || maxY === minY) {
            return null;
        }
        const width = maxX - minX;
        const height = maxY - minY;
        const SCALE = 25;
        const MAX_DIM = 1500;
        let canvasW = Math.max(1, Math.round(width * SCALE));
        let canvasH = Math.max(1, Math.round(height * SCALE));
        if (canvasW > MAX_DIM || canvasH > MAX_DIM) {
            const f = MAX_DIM / Math.max(canvasW, canvasH);
            canvasW = Math.max(1, Math.round(canvasW * f));
            canvasH = Math.max(1, Math.round(canvasH * f));
        }
        const transform = ([x, y]) => {
            const xn = (x - minX) / (maxX - minX);
            const yn = (y - minY) / (maxY - minY);
            return [Math.round(xn * canvasW), Math.round((1 - yn) * canvasH)];
        };
        const bitmap = PImage.make(canvasW, canvasH);
        const ctx = bitmap.getContext("2d");
        const drawPoly = (pts, fill, stroke, lineWidth = 1) => {
            if (!pts || pts.length < 2) {
                return;
            }
            const tp = [];
            for (const p of pts) {
                const [x, y] = transform(p);
                if (tp.length === 0 || tp[tp.length - 1][0] !== x || tp[tp.length - 1][1] !== y) {
                    tp.push([x, y]);
                }
            }
            while (tp.length > 1 && tp[tp.length - 1][0] === tp[0][0] && tp[tp.length - 1][1] === tp[0][1]) {
                tp.pop();
            }
            if (tp.length < 2) {
                return;
            }
            ctx.beginPath();
            ctx.moveTo(tp[0][0], tp[0][1]);
            for (let i = 1; i < tp.length; i++) {
                ctx.lineTo(tp[i][0], tp[i][1]);
            }
            ctx.closePath();
            if (fill) {
                ctx.fillStyle = fill;
                ctx.fill();
            }
            if (stroke) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = lineWidth;
                ctx.stroke();
            }
        };
        for (const pts of collected.region_channel) {
            drawPoly(pts, "rgba(128,128,128,0.35)", "rgba(128,128,128,1)");
        }
        for (const pts of collected.region_work) {
            drawPoly(pts, "rgba(34,139,34,1)", "rgba(0,0,0,1)");
        }
        for (const pts of collected.region_forbidden) {
            drawPoly(pts, "rgba(240,128,128,0.78)", "rgba(255,0,0,1)");
        }
        for (const pts of collected.region_placed_blank) {
            drawPoly(pts, "rgba(0,0,255,0.59)", "rgba(0,0,255,1)");
        }
        for (const pts of collected.divide_area_work) {
            drawPoly(pts, null, "rgba(0,0,0,1)", 2);
        }
        for (const pts of collected.region_obstacle) {
            drawPoly(pts, "rgba(128,128,128,0.78)", "rgba(169,169,169,1)");
        }
        if (Array.isArray(pathData) && pathData.length >= 2) {
            const pp = [];
            for (const e of pathData) {
                if (!Array.isArray(e) || e.length < 2) {
                    continue;
                }
                const [px, py] = transform([e[0], e[1]]);
                if (pp.length === 0 || pp[pp.length - 1][0] !== px || pp[pp.length - 1][1] !== py) {
                    pp.push([px, py]);
                }
            }
            if (pp.length >= 2) {
                ctx.strokeStyle = "rgba(124,252,0,1)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pp[0][0], pp[0][1]);
                for (let i = 1; i < pp.length; i++) {
                    ctx.lineTo(pp[i][0], pp[i][1]);
                }
                ctx.stroke();
            }
        }
        const charger = mapData.charge_pos && Array.isArray(mapData.charge_pos.point) ? mapData.charge_pos.point : null;
        if (charger && charger.length >= 2 && (charger[0] !== 0 || charger[1] !== 0)) {
            const [cx, cy] = transform([charger[0], charger[1]]);
            ctx.fillStyle = "rgba(255,200,0,1)";
            ctx.beginPath();
            ctx.arc(cx, cy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,1)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, 6, 0, Math.PI * 2);
            ctx.stroke();
        }
        const chunks = [];
        const sink = new Writable({
            write(chunk, _enc, cb) {
                chunks.push(Buffer.from(chunk));
                cb();
            },
        });
        await PImage.encodePNGToStream(bitmap, sink);
        const buf = Buffer.concat(chunks);
        return `data:image/png;base64,${buf.toString("base64")}`;
    }

    /**
     * @param {string} sn
     * @param {string} name
     * @param {string} url
     */
    async fetchMapImage(sn, name, url) {
        if (!url) {
            this.log.debug(`fetchMapImage ${sn}/${name}: keine URL`);
            return;
        }
        this.log.debug(`fetchMapImage ${sn}/${name}: GET ${String(url).slice(0, 120)}`);
        const res = await axios.get(url, {
            timeout: 30000,
            responseType: "arraybuffer",
            validateStatus: () => true,
        });
        if (res.status !== 200 || !res.data) {
            this.log.debug(`fetchMapImage ${sn}/${name}: HTTP ${res.status} leer`);
            return;
        }
        const buf = Buffer.from(res.data);
        let ct = String(res.headers["content-type"] || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
        if (!ct || ct === "application/octet-stream" || !ct.startsWith("image/")) {
            if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
                ct = "image/png";
            } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
                ct = "image/jpeg";
            } else if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
                ct = "image/gif";
            } else if (
                buf.length >= 12 &&
                buf[0] === 0x52 &&
                buf[1] === 0x49 &&
                buf[2] === 0x46 &&
                buf[3] === 0x46 &&
                buf[8] === 0x57 &&
                buf[9] === 0x45 &&
                buf[10] === 0x42 &&
                buf[11] === 0x50
            ) {
                ct = "image/webp";
            } else {
                ct = "image/png";
            }
        }
        const b64 = buf.toString("base64");
        const dataUrl = `data:${ct};base64,${b64}`;
        await this.extendObject(`${sn}.map.${name}`, {
            type: "state",
            common: {
                name: `Karten-${name} (data URL)`,
                type: "string",
                role: "value",
                read: true,
                write: false,
            },
            native: {},
        });
        this.setState(`${sn}.map.${name}`, dataUrl, true);
        this.log.debug(`fetchMapImage ${sn}/${name}: ${ct}, ${buf.length} Bytes geschrieben`);
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
