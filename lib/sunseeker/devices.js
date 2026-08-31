"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Buffer } = require("node:buffer");

const CMDURL_SXV = "/iot_mower/wireless/device/";
const CMDURL_V1 = "/app_wirelessv1_mower/wirelessv1/device/";

module.exports = {
    /**
     * Read the bundled event-code JSON for the configured language.
     *
     * @param {string} language
     */
    loadEventCodes(language) {
        const lang = String(language || "de")
            .toLowerCase()
            .slice(0, 2);
        try {
            const file = path.join(__dirname, "eventcodes.json");
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            const fallback = "en";
            this.eventCodes = data.events[lang] || data.events[fallback] || {};
            this.v1EventCodes = data.v1Events[lang] || data.v1Events[fallback] || {};
        } catch (err) {
            this.iob.log.debug(`Event codes cannot be loaded: ${err.message}`);
            this.eventCodes = {};
            this.v1EventCodes = {};
        }
    },

    /**
     * @param {string} modelName e.g. "S2", "X3", "V18", "V1Pro"
     * @returns {"S"|"X"|"V"|"V1"}
     */
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
    },

    /**
     * @param {string} modelName e.g. "S2", "X3", "V18", "V1Pro"
     * @returns {"Gen0"|"Gen1"|"Gen2"|"Gen3"}
     */
    classifyGeneration(modelName) {
        if (["X3", "X4", "X5", "X7", "X9", "S3", "S4", "S5"].includes(modelName)) {
            return "Gen1";
        } else if (["X3 Gen2", "X5 Gen2", "X7 Gen2", "S5 Gen2"].includes(modelName)) {
            return "Gen2";
        } else if (["X5 Gen3", "X7 Gen3", "X7 Plus Gen3"].includes(modelName)) {
            return "Gen2";
        }
        return "Gen0";
    },

    /**
     * @param {string} sn
     */
    async readLivemapSettings(sn) {
        const lm_states = await this.iob.getStatesAsync(`${this.iob.namespace}.${sn}.map.map_settings.*`);
        if (lm_states) {
            this.livemapSettings[sn] = {};
            for (const lm_state in lm_states) {
                const split = lm_state.split(".");
                const state = split.pop();
                if (state) {
                    this.livemapSettings[sn][state] = lm_states[lm_state].val;
                }
            }
        }
    },

    /**
     * @param {string} sn
     * @param {ioBroker.State | null | undefined} value
     * @param {string} attribut
     */
    setLiveSettings(sn, value, attribut) {
        if (value) {
            this.iob.log.debug(`setLiveSettings: ${sn} - ${value.val} - ${attribut}`);
            this.livemapSettings[sn][attribut] = value.val;
        }
    },

    /**
     * Pick MQTT broker based on the FIRST device's model class. Mixed accounts
     * (V1 + S/X) connect through the wrong broker for the minority — pre-existing
     * limitation, not fixed in this refactor.
     */
    mqttBroker() {
        const first = Object.values(this.deviceMeta)[0];
        const v1 = first && first.modelClass === "V1";
        if (v1) {
            return this.options.region === "US"
                ? { host: "app.mqttv1-us.sk-robot.com", port: 32884 }
                : { host: "app.mqttv1-eu.sk-robot.com", port: 32884 };
        }
        // Prefer the wirefree broker domain reported by /admin/user/app/info
        // (mqttWirefreeDomainName), exactly like the app; fall back to region.
        if (this.mqttWirefreeDomain) {
            return { host: this.mqttWirefreeDomain, port: 1884 };
        }
        return this.options.region === "US"
            ? { host: "wfsmqtt-specific-us.sk-robot.com", port: 1884 }
            : { host: "wfsmqtt-specific.sk-robot.com", port: 1884 };
    },

    /**
     * Initialization Meta
     *
     * @param {any} d
     * @returns {any}
     */
    _initDeviceMeta(d) {
        const modelClass = this.classifyModel(d.modelName);
        const gen = this.classifyGeneration(d.modelName);
        return {
            modelClass,
            gen,
            cmdurl: modelClass === "V1" ? CMDURL_V1 : CMDURL_SXV,
            deviceId: null,
            robotPos: null,
            chargerPos: null,
            livePath: [],
            _refreshTimer: null,
            _mapInFlight: false,
            _mapMqttInFlight: false,
            _requestTimer: null,
            _pathCheckTimer: null,
            mapJson: null,
            pathJson: null,
            pathJsonMqtt: null,
            mapid: undefined,
            fw: d.firmwareVersion,
            fw_new: "",
            fw_base: "",
            fw_base_new: "",
            livemap: false,
            time_custom_flag: true,
            recommended_time_flag: false,
            time_zone: 3600,
            start: 1,
            total: 0,
            sid: "",
            status: 0,
            event_code: 0,
            work: false,
            work_time: false,
            path_id_old: 0,
            path_id_new: 0,
            diff: 4000,
            lastUpdate: 0,
            custom_multi: {},
            custom_multi_sort: {},
        };
    },

    /**
     * @param {string} sn
     * @param {any} data
     */
    setScheduleInfo(sn, data) {
        const meta = this.deviceMeta[sn];
        let custom = false;
        let recommended = false;
        let set = 0;
        if (data && typeof data.time_custom_flag === "boolean") {
            meta.time_custom_flag = data.time_custom_flag;
            custom = data.time_custom_flag;
        }
        if (data && typeof data.recommended_time_flag === "boolean") {
            meta.recommended_time_flag = data.recommended_time_flag;
            recommended = data.recommended_time_flag;
        }
        if (data && typeof data.time_zone === "number") {
            meta.time_zone = data.time_zone;
        }
        if (recommended && custom) {
            set = 2;
        } else if (!recommended && custom) {
            set = 1;
        }
        this.emit("mode", { sn: sn, mode: set });
    },

    /**
     * @param {string} sn
     * @param {number} mode
     */
    setScheduleMode(sn, mode) {
        const meta = this.deviceMeta[sn];
        if (mode == 0) {
            meta.time_custom_flag = false;
            meta.recommended_time_flag = true;
        } else if (mode == 1) {
            meta.time_custom_flag = true;
            meta.recommended_time_flag = false;
        } else if (mode == 2) {
            meta.time_custom_flag = true;
            meta.recommended_time_flag = true;
        }
    },

    /**
     * Fetch device event list.
     *
     * @param {string} sn
     * @param {number} current
     * @param {number} size
     */
    async getEvents(sn, current, size) {
        let apiPath = `/app_wireless_mower/work_record/page?sn=${sn}&current=${current}&size=${size}`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (json && json.data && json.data.records && Array.isArray(json.data.records)) {
            this.iob.log.debug(`Device work records: ${JSON.stringify(json.data.records)}`);
            if (this.eventCodes) {
                for (const r of json.data.records) {
                    if (r.startReason != null) {
                        r.startReason = this.eventCodes[r.startReason];
                    }
                    if (r.endReason != null) {
                        r.endReason = this.eventCodes[r.endReason];
                    }
                }
                await this.iob.setState(`${this.iob.namespace}.${sn}.events.systemMessage`, {
                    val: JSON.stringify(json.data.records),
                    ack: true,
                });
            }
        } else {
            try {
                this.iob.log.debug(`Device record list is empty: ${JSON.stringify(json.data)}`);
            } catch {
                this.iob.log.warn(`Device record list is empty!!`);
            }
        }
        this.countUnreadMessage(sn, 1, "unreadSystemMessage");
        this.countUnreadMessage(sn, 2, "unreadEventMessage");
        this.getSystemMessage(sn);
        this.getEventNotification(sn);
    },

    /**
     * @param {string} sn
     */
    async getEventNotification(sn) {
        let apiPath = `/app_wireless_mower/work_record/work_event_info/page?sn=${sn}&current=1&size=10&actualTime=true&type=2`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (json && json.data && json.data.records && Array.isArray(json.data.records)) {
            this.iob.log.debug(`Device notification: ${JSON.stringify(json.data.records)}`);
            if (this.eventCodes) {
                for (const r of json.data.records) {
                    if (r.code != null) {
                        r.code = this.eventCodes[r.code];
                    }
                }
                await this.iob.setState(`${sn}.events.eventNotification`, {
                    val: JSON.stringify(json.data.records),
                    ack: true,
                });
            }
        } else {
            try {
                this.iob.log.debug(`Device notification list is empty: ${JSON.stringify(json.data)}`);
            } catch {
                this.iob.log.warn(`Device notification list is empty!!`);
            }
        }
    },

    /**
     * @param {string} sn
     * @param {number} type
     * @param {string} name
     */
    async countUnreadMessage(sn, type, name) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            return;
        }
        const apiPath = `/app_wireless_mower/message-send-logs/count/${String(dev.appUserId || this.session.user_id)}?type=${type}`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        this.iob.log.debug(`${name}: ${JSON.stringify(json)}`);
        if (json && typeof json.data === "number") {
            await this.iob.setState(`${sn}.events.${name}`, { val: json.data, ack: true });
        }
    },

    /**
     * @param {string} sn
     */
    async getSystemMessage(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            return;
        }
        const apiPath = `/app_wireless_mower/message-send-logs/page/${String(dev.appUserId || this.session.user_id)}?ascFlag=false&current=1&size=20&sort=createdAt&type=1`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        this.iob.log.debug(`systemmessage: ${JSON.stringify(json)}`);
        if (json && typeof json.data && json.data.records) {
            await this.iob.setState(`${sn}.events.systemMessage`, {
                val: JSON.stringify(json.data.records),
                ack: true,
            });
        }
    },

    /**
     * Fetch the account device list. Populates this.devicesRaw and
     * this.deviceMeta, then emits a 'devices' event with the raw array.
     */
    async getDevices() {
        const apiPath =
            this.options.apptype === "Old"
                ? "/mower/device-user/list"
                : "/app_wireless_mower/device-user/getCustomDevice?all=true";
        this.iob.log.debug(`getDevices: ${apiPath}`);
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (!Array.isArray(json.data)) {
            this.iob.log.warn(`Device list empty: ${JSON.stringify(json)}`);
            this.emit("devices", { devices: [] });
            return [];
        }
        this.iob.log.debug(`getDevices: Found ${json.data.length} device(s)`);
        this.iob.log.debug(`getDevices data: ${JSON.stringify(json.data)}`);
        for (const d of json.data) {
            const sn = d.deviceSn.replace(/this.FORBIDDEN_CHARS/gu, "_");
            this.devicesRaw[sn] = d;
            this.deviceMeta[sn] = this._initDeviceMeta(d);
            if (typeof d.picUrl === "string" && d.picUrl.startsWith("http")) {
                d["picUrlData"] = await this.getImage(d.picUrl, sn, "mower");
            }
            if (typeof d.picUrlDetail === "string" && d.picUrlDetail.startsWith("http")) {
                d["picUrlDetailData"] = await this.getImage(d.picUrlDetail, sn, "mowerDetail");
            }
            const sid = await this.iob.getStateAsync(`${sn}.mower_raw.iobroker_sid`);
            if (sid && typeof sid.val === "string" && sid.val != "") {
                this.deviceMeta[sn].sid = sid.val;
            } else {
                const random_sid = this.randomString(16);
                this.deviceMeta[sn].sid = random_sid;
                const common = {
                    name: d.deviceName || sn,
                    icon: d["picUrlData"] != null ? d["picUrlData"] : "img/mower.png",
                    statusStates: {
                        onlineId: `${this.namespace}.${sn}.mower_raw.onlineFlag`,
                    },
                };
                await this.createDataPoint(`${this.iob.namespace}.${sn}`, common, "device", null, null, null);
                if (this.options.apptype === "New") {
                    this.emit("records", sn);
                }
                await this.iob
                    .setObjectNotExistsAsync(`${this.iob.namespace}.${sn}.mower_raw.iobroker_sid`, {
                        type: "state",
                        common: {
                            name: {
                                en: "ID for Livemap requests",
                                de: "ID für Livemap-Anfragen",
                                ru: "Идентификатор для запросов Livemap",
                                pt: "ID para pedidos do Livemap",
                                nl: "ID voor Livemap-verzoeken",
                                fr: "Identifiant pour les requêtes Livemap",
                                it: "ID per le richieste Livemap",
                                es: "ID para las solicitudes de Livemap",
                                pl: "Identyfikator żądań Livemap",
                                uk: "Ідентифікатор для запитів до Livemap",
                                "zh-cn": "ID for Livemap requests",
                            },
                            type: "string",
                            role: "state",
                            write: false,
                            read: true,
                            def: "",
                        },
                        native: {},
                    })
                    .then(() => {
                        this.iob.setState(`${this.iob.namespace}.${sn}.mower_raw.iobroker_sid`, {
                            val: random_sid,
                            ack: true,
                        });
                    })
                    .catch((/** @type {{ name: any; message: any; }} */ error) => {
                        this.log.error(`SID: ${error.name}: ${error.message}`);
                    });
            }
            this.iob.log.info(`Device: sn=${sn} model=${d.modelName} name=${d.deviceName}`);
            if (this.deviceMeta[sn].modelClass === "S") {
                await this.createLivemapSettings(sn);
                await this.readLivemapSettings(sn);
            }
        }
        this.emit("devices", { devices: json.data });
        return json.data;
    },
    /**
     * @param {string} url
     * @param {string} [sn]
     * @param {string} [name]
     */
    async getImage(url, sn, name) {
        const oldFile = await this.iob.fileExistsAsync(`${this.iob.namespace}`, `${sn}/${name}.png`);
        if (!oldFile) {
            const resp = await this.getImages(url);
            if (typeof resp === "object") {
                const file = url.split(".");
                const ext = file.pop();
                await this.iob.writeFileAsync(`${this.iob.namespace}`, `${sn}/${name}.${ext}`, resp);
                const mime = Buffer.from(resp).toString("base64");
                return `data:image/${ext};base64,${mime}`;
            }
            this.iob.log.error(`ICON ERROR: ${JSON.stringify(resp)}`);
            return null;
        }
        const { file, mimeType } = await this.iob.readFileAsync(this.iob.namespace, `${sn}/${name}.png`);
        if (file && mimeType) {
            const mime = Buffer.from(file).toString("base64");
            return `data:${mimeType};base64,${mime}`;
        }
        return null;
    },
};

module.exports.CMDURL_SXV = CMDURL_SXV;
module.exports.CMDURL_V1 = CMDURL_V1;
