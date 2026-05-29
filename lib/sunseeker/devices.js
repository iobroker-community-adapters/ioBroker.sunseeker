"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
            this.log.debug(`Event codes cannot be loaded: ${err.message}`);
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
     * Pick MQTT broker based on the FIRST device's model class. Mixed accounts
     * (V1 + S/X) connect through the wrong broker for the minority — pre-existing
     * limitation, not fixed in this refactor.
     */
    mqttBroker() {
        const first = Object.values(this.deviceMeta)[0];
        const v1 = first && first.modelClass === "V1";
        if (this.options.region === "US") {
            return v1
                ? { host: "app.mqttv1-us.sk-robot.com", port: 32884 }
                : { host: "wfsmqtt-specific-us.sk-robot.com", port: 1884 };
        }
        return v1
            ? { host: "app.mqttv1-eu.sk-robot.com", port: 32884 }
            : { host: "wfsmqtt-specific.sk-robot.com", port: 1884 };
    },

    /**
     * Initialization Meta
     *
     * @param {{ modelName: string; }} d
     */
    _initDeviceMeta(d) {
        const modelClass = this.classifyModel(d.modelName);
        return {
            modelClass,
            cmdurl: modelClass === "V1" ? CMDURL_V1 : CMDURL_SXV,
            robotPos: null,
            chargerPos: null,
            livePath: [],
            _refreshTimer: null,
            _mapInFlight: false,
            mapJson: null,
            pathJson: null,
            mapid: undefined,
        };
    },

    /**
     * Fetch device event list.
     *
     * @param {string} sn
     * @param {number} current
     * @param {number} size
     */
    async getEvents(sn, current, size) {
        const apiPath = `/app_wireless_mower/work_record/page?sn=${sn}&current=${current}&size=${size}`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (json && json.data && json.data.records && Array.isArray(json.data.records)) {
            this.log.debug(`Device work records: ${JSON.stringify(json.data.records)}`);
            if (this.eventCodes) {
                for (const r of json.data.records) {
                    if (r.startReason != null) {
                        r.startReason = this.eventCodes[r.startReason];
                    }
                    if (r.endReason != null) {
                        r.endReason = this.eventCodes[r.endReason];
                    }
                }
                this.emit("records", { sn, records: json.data.records });
            }
        } else {
            try {
                this.log.warn(`Device record list is empty: ${JSON.stringify(json.data)}`);
            } catch {
                this.log.warn(`Device record list is empty!!`);
            }
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
        this.log.debug(`getDevices: ${apiPath}`);
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (!Array.isArray(json.data)) {
            this.log.warn(`Device list empty: ${JSON.stringify(json)}`);
            this.emit("devices", { devices: [] });
            return [];
        }
        this.log.debug(`getDevices: Found ${json.data.length} device(s)`);
        for (const d of json.data) {
            const sn = d.deviceSn;
            this.devicesRaw[sn] = d;
            this.deviceMeta[sn] = this._initDeviceMeta(d);
            this.log.info(`Device: sn=${sn} model=${d.modelName} name=${d.deviceName}`);
            if (this.options.apptype === "New") {
                await this.getEvents(sn, 1, 10);
            }
        }
        this.emit("devices", { devices: json.data });
        return json.data;
    },
};

module.exports.CMDURL_SXV = CMDURL_SXV;
module.exports.CMDURL_V1 = CMDURL_V1;
