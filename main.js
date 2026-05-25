"use strict";

/*
 * ioBroker.sunseeker
 *
 * Thin adapter wrapping the Sunseeker client library at lib/sunseeker/. The
 * library handles REST + MQTT against the Sunseeker cloud and emits events;
 * the adapter translates those events to ioBroker objects/states via json2iob.
 */

const utils = require("@iobroker/adapter-core");
const Json2iob = require("json2iob");
const Sunseeker = require("./lib/sunseeker");

const ERRORTYPE_LABELS = {
    0: "normal",
    2: "Trapped",
    16: "No border",
    32: "Started outside border",
    262144: "Charging power to high",
};

class SunseekerAdapter extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    constructor(options) {
        super({ ...options, name: "sunseeker" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.json2iob = new Json2iob(this);
        /** @type {Sunseeker | null} */
        this.sunseeker = null;
        this.updateDeviceCommand = null;
        this.updateDeviceRain = null;
        this.updateDeviceBlade = null;
        this.updateDeviceSet = null;
    }

    async onReady() {
        this.setState("info.connection", false, true);

        const cfg = this.config;
        if (!cfg.username || !cfg.password) {
            this.log.error("Bitte Benutzername und Passwort in den Adapter-Einstellungen setzen");
            return;
        }

        const logger = {
            info: (/** @type {string} */ m) => this.log.info(m),
            warn: (/** @type {string} */ m) => this.log.warn(m),
            error: (/** @type {string} */ m) => this.log.error(m),
            debug: (/** @type {string} */ m) => this.log.debug(m),
        };

        const iobTimers = {
            setTimeout: (/** @type {any} */ c, /** @type {number} */ t) => this.setTimeout(c, t),
            clearTimeout: (/** @type {ioBroker.Timeout | undefined} */ x) => this.clearTimeout(x),
            setInterval: (/** @type {any} */ c, /** @type {number} */ t) => this.setInterval(c, t),
            clearInterval: (/** @type {ioBroker.Interval | undefined} */ x) => this.clearInterval(x),
        };

        this.sunseeker = new Sunseeker(cfg.username, cfg.password, {
            region: cfg.region || "EU",
            apptype: cfg.apptype || "New",
            language: cfg.language || "de-DE",
            interval: Number(cfg.interval) > 0 ? Number(cfg.interval) : 300,
            refreshAfterMqttMs: 1500,
            logger,
            iobTimers,
        });

        this.sunseeker.on("devices", payload => this.onSunseekerDevices(payload));
        this.sunseeker.on("status", payload => this.onSunseekerStatus(payload));
        this.sunseeker.on("mqtt", payload => this.onSunseekerMqtt(payload));
        this.sunseeker.on("map", payload => this.onSunseekerMap(payload));
        this.sunseeker.on("livemap", payload => this.onSunseekerLivemap(payload));
        this.sunseeker.on("mqttConnect", () => this.setState("info.connection", true, true));
        this.sunseeker.on("mqttDisconnect", () => this.setState("info.connection", false, true));
        this.sunseeker.on("error", err => this.log.error(err.message || String(err)));

        this.subscribeStates("*");

        try {
            await this.sunseeker.start();
        } catch (err) {
            this.log.error(`Start fehlgeschlagen: ${err.message}`);
            return;
        }
        this.setState("info.connection", true, true);

        try {
            await this.sunseeker.updateAllDevices();
        } catch (err) {
            this.log.warn(`Initial-Update: ${err.message}`);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {() => void} callback - Callback function
     */
    async onUnload(callback) {
        try {
            if (this.sunseeker) {
                this.sunseeker.stop();
                this.sunseeker = null;
            }
            this.updateDeviceCommand && this.clearTimeout(this.updateDeviceCommand);
            this.updateDeviceRain && this.clearTimeout(this.updateDeviceRain);
            this.updateDeviceBlade && this.clearTimeout(this.updateDeviceBlade);
            this.updateDeviceSet && this.clearTimeout(this.updateDeviceSet);
            this.setState("info.connection", false, true);
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${error.message}`);
            callback();
        }
    }

    /**
     * States for Device
     *
     * @param {string} sn
     */
    statesForDevice(sn) {
        if (!this.sunseeker) {
            return { errortype: { ...ERRORTYPE_LABELS } };
        }
        const meta = this.sunseeker.deviceMeta[sn];
        const events = this.sunseeker.getEventCodes(meta && meta.modelClass);
        const states = {
            0: `${meta && meta.modelClass == "X" && meta.modelClass == "S" ? "unknown" : "standby"}`,
            1: `${meta && meta.modelClass == "X" && meta.modelClass == "S" ? "idle" : "mowing"}`,
            2: `${meta && meta.modelClass == "X" && meta.modelClass == "S" ? "working" : "going home"}`,
            3: `${meta && meta.modelClass == "X" && meta.modelClass == "S" ? "pause" : "charging"}`,
            4: "unknown",
            5: "unknown",
            6: "error",
            7: `${meta && meta.modelClass == "X" && meta.modelClass == "S" ? "return" : "mowing border"}`,
            8: "pause",
            9: "charging",
            10: "charging full",
            11: "unknown",
            12: "unknown",
            13: "offline",
            14: "continue cutting",
            15: "location",
            16: "firmware update",
            17: "stuck",
            18: "stop",
            19: "unknown",
            20: "enter pin",
        };
        return {
            event_code: { ...events },
            errortype: { ...ERRORTYPE_LABELS },
            faultStatusCode: { ...ERRORTYPE_LABELS },
            status: states,
        };
    }

    async onSunseekerDevices({ devices }) {
        if (!Array.isArray(devices)) {
            return;
        }
        for (const d of devices) {
            const sn = d.deviceSn;
            await this.extendObject(sn, {
                type: "device",
                common: { name: d.deviceName || sn },
                native: {},
            });
            if (this.sunseeker) {
                const meta = this.sunseeker.deviceMeta[sn];
                if (meta && (meta.modelClass === "S" || d.modelClass === "X")) {
                    await this.extendObject(`${sn}.map`, {
                        type: "channel",
                        common: {
                            name: {
                                en: "Maps",
                                de: "Karten",
                                ru: "Карты",
                                pt: "Mapas",
                                nl: "Kaarten",
                                fr: "Cartes",
                                it: "Mappe",
                                es: "Mapas",
                                pl: "Mapy",
                                uk: "Карти",
                                "zh-cn": "地图",
                            },
                        },
                        native: {},
                    });
                }
            }
            await this.delObjectAsync(`${sn}.list`, { recursive: true }).catch(() => {});
            await this.json2iob.parse(`${sn}.general`, d, {
                channelName: "Allgemein",
                forceIndex: false,
            });
            await this.ensureRemoteButtons(sn);
            await this.ensureScheduleStates(sn);
        }
    }

    async onSunseekerStatus({ sn, status, settings }) {
        const states = this.statesForDevice(sn);
        if (status) {
            await this.json2iob.parse(`${sn}.status`, status, {
                channelName: "Status",
                forceIndex: false,
                states,
            });
        }
        if (settings) {
            const normalized = this.normalizeSettings(settings);
            await this.ensureWritableSettings(sn, normalized);
            await this.json2iob.parse(`${sn}.settings`, normalized, {
                channelName: "Einstellungen",
                forceIndex: false,
                states,
            });
        }
    }

    /**
     * Coerce numeric/boolean settings fields to their canonical types so
     * json2iob and the typed states defined in ensureWritableSettings agree.
     *
     * @param {Record<string, any>} settings
     */
    normalizeSettings(settings) {
        const out = { ...settings };
        for (const key of ["bladeSpeed", "bladeHeight", "rainDelayDuration"]) {
            if (out[key] !== undefined && out[key] !== null && out[key] !== "") {
                const n = Number(out[key]);
                if (Number.isFinite(n)) {
                    out[key] = n;
                }
            }
        }
        if (out.rainFlag !== undefined && out.rainFlag !== null) {
            out.rainFlag =
                out.rainFlag === true || out.rainFlag === "true" || out.rainFlag === 1 || out.rainFlag === "1";
        }
        return out;
    }

    onSunseekerMqtt({ sn, data }) {
        if (!data) {
            return;
        }
        this.json2iob.parse(`${sn}.status`, data, {
            channelName: "Status",
            forceIndex: false,
            states: this.statesForDevice(sn),
        });
    }

    async onSunseekerMap({ sn, kind, payload }) {
        if (kind === "info") {
            await this.json2iob.parse(`${sn}.map.info`, payload, {
                channelName: "Karte",
                forceIndex: false,
            });
            return;
        }
        if (kind === "backup") {
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
            this.setState(`${sn}.map.backup`, JSON.stringify(payload), true);
            return;
        }
        if (kind === "mapData" || kind === "pathData") {
            await this.extendObject(`${sn}.map.${kind}`, {
                type: "state",
                common: {
                    name: `Karten-${kind} (JSON)`,
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                },
                native: {},
            });
            this.setState(`${sn}.map.${kind}`, payload, true);
            return;
        }
        // image / wifi / net / texture (data URLs)
        await this.extendObject(`${sn}.map.${kind}`, {
            type: "state",
            common: {
                name: `Karten-${kind} (data URL)`,
                type: "string",
                role: "value",
                read: true,
                write: false,
            },
            native: {},
        });
        this.setState(`${sn}.map.${kind}`, payload, true);
    }

    async onSunseekerLivemap({ sn, dataUrl }) {
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
    }

    /**
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (!state || state.ack || !this.sunseeker) {
            return;
        }
        const parts = id.split(".");
        const scheduleIdx = parts.indexOf("schedule");
        if (scheduleIdx > 0 && parts[scheduleIdx + 1]) {
            const sn = parts[scheduleIdx - 1];
            const leaf = parts[scheduleIdx + 1];
            if (leaf === "set") {
                try {
                    const plan = await this.collectSchedulePlan(sn);
                    await this.sunseeker.setSchedule(sn, plan);
                    this.updateDeviceSet = this.setTimeout(
                        () => this.sunseeker?.updateDevice(sn).catch(() => {}),
                        1500,
                    );
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
                    await this.sunseeker.setBlade(sn, key, Number(state.val));
                    this.updateDeviceBlade = this.setTimeout(
                        () => this.sunseeker?.updateDevice(sn).catch(() => {}),
                        1500,
                    );
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
                    await this.sunseeker.setRain(sn, Boolean(flagVal), Math.round(Number(durVal) || 0));
                    this.updateDeviceRain = this.setTimeout(
                        () => this.sunseeker?.updateDevice(sn).catch(() => {}),
                        1500,
                    );
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
        if (!this.sunseeker.devicesRaw[sn]) {
            this.log.warn(`onStateChange: Gerät ${sn} unbekannt`);
            return;
        }
        try {
            if (command === "refresh") {
                await this.sunseeker.updateDevice(sn);
            } else {
                await this.sunseeker.sendCommand(sn, command, state.val);
                this.updateDeviceCommand = this.setTimeout(
                    () => this.sunseeker?.updateDevice(sn).catch(() => {}),
                    1500,
                );
            }
            this.setState(id, { val: state.val, ack: true });
        } catch (err) {
            this.log.error(`Befehl ${command} für ${sn} fehlgeschlagen: ${err.message}`);
        }
    }

    /**
     * @param {string} sn
     */
    async collectSchedulePlan(sn) {
        const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        const plan = {};
        for (const day of days) {
            const st = await this.getStateAsync(`${sn}.schedule.${day}`);
            plan[day] = st && st.val ? String(st.val) : "";
        }
        const pauseSt = await this.getStateAsync(`${sn}.schedule.pause`);
        plan.pause = !!(pauseSt && pauseSt.val);
        return plan;
    }

    /**
     * @param {string} sn
     */
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

    /**
     * @param {string} sn
     */
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

    /**
     * @param {string} sn
     * @param {Record<string, any>} settingsData
     */
    async ensureWritableSettings(sn, settingsData) {
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
}

if (require.main !== module) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = options => new SunseekerAdapter(options);
} else {
    new SunseekerAdapter();
}
