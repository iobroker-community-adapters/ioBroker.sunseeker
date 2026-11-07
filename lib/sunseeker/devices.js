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
            this.emit("error", "Event codes cannot be loaded", err);
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
        } else if (["X3 Gen2", "X5 Gen 2", "X7 Gen 2", "S5 Gen 2"].includes(modelName)) {
            return "Gen2";
        } else if (["X5 Gen 3", "X7 Gen3", "X7 Plus Gen 3"].includes(modelName)) {
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
                    this.livemapSettings[sn][state] = this.hexToRGBA(lm_states[lm_state].val);
                }
            }
        }
    },

    /**
     * The response is provided via MQTT. Code 0 indicates that it is supported,
     * while code -1003 indicates that it is not supported.
     */
    async function_checks() {
        const checks = [
            "reserveStillRegion",
            "setAutoBuildmapLawn",
            "setRgbdObs",
            "deleteCustom",
            "workOrder",
            "setDrawEdge",
            "setFollowBorderLaps",
            "updateChargerPosRtk",
            "autoRideEdgeMap",
        ];
        for (const dev of Object.values(this.devicesRaw)) {
            for (const check of checks) {
                this.delay(200);
                const data = {
                    appId: String(dev.appUserId || this.session.user_id),
                    deviceSn: dev.deviceSn,
                    id: "functionCheck",
                    key: check,
                    method: "function_check",
                };
                const res = await this.request(
                    "POST",
                    "/iot_mower/wireless/device/function_check",
                    { ...this.authHeaders(), "Content-Type": "application/json; charset=UTF-8" },
                    JSON.stringify(data),
                );
                if (res.json && res.json.ok === false) {
                    this.log.error(`API function_check: ${res.json.msg}`);
                } else {
                    this.log.debug(`function_checks: ${JSON.stringify(res.json)}`);
                }
            }
        }
    },

    /**
     * The response is provided via MQTT. Code 0 indicates that it is supported,
     * while code -1003 indicates that it is not supported.
     *
     * @param {string} sn
     * @param {string} check
     */
    async function_check(sn, check) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            return false;
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: sn,
            id: "functionCheck",
            key: check,
            method: "function_check",
        };
        const res = await this.request(
            "POST",
            "/iot_mower/wireless/device/function_check",
            { ...this.authHeaders(), "Content-Type": "application/json; charset=UTF-8" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API single function_check: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`Single function_check: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} pattern
     */
    patternSize(pattern) {
        const patternSize = {
            LOGO_S: 2.4,
            CIRCLE: 2.4,
            FOUR_POINT_STAR: 2.4,
            TRIANGLE: 2.4,
            HEART: 2.4,
            NUMB_0: 2.4,
            NUMB_1: 2.4,
            NUMB_2: 2.4,
            NUMB_3: 2.4,
            NUMB_4: 2.4,
            NUMB_5: 2.4,
            NUMB_6: 2.4,
            NUMB_7: 2.4,
            NUMB_8: 2.4,
            NUMB_9: 2.4,
            FIVE_POINT_STAR: 2.4,
            FOOTBALL: 4.8,
            TROPHY: 4.8,
        };
        return patternSize[pattern];
    },

    /**
     * @param {string | boolean | number} hex
     * @returns {string | boolean | number}
     */
    hexToRGBA(hex) {
        const isValidHex = hex => /^#([A-Fa-f0-9]{3,4}){1,2}$/.test(hex);
        const getChunksFromString = (st, chunkSize) => st.match(new RegExp(`.{${chunkSize}}`, "g"));
        const convertHexUnitTo256 = hexStr => parseInt(hexStr.repeat(2 / hexStr.length), 16);
        const getAlphafloat = (a, alpha) => {
            if (typeof a !== "undefined") {
                return a / 255;
            }
            if (typeof alpha != "number" || alpha < 0 || alpha > 1) {
                return 1;
            }
            return alpha;
        };
        const convertHexToRGBA = (hex, alpha) => {
            if (typeof hex === "boolean") {
                return hex;
            }
            if (!isValidHex(hex)) {
                return hex;
            }
            const chunkSize = Math.floor((hex.length - 1) / 3);
            const hexArr = getChunksFromString(hex.slice(1), chunkSize);
            const [r, g, b, a] = hexArr.map(convertHexUnitTo256);
            return `rgba(${r}, ${g}, ${b}, ${Math.round(getAlphafloat(a, alpha) * 100) / 100})`;
        };
        return convertHexToRGBA(hex);
    },

    /**
     * @param {string} sn
     * @param {ioBroker.State | null | undefined} value
     * @param {string} attribut
     */
    setLiveSettings(sn, value, attribut) {
        if (
            value &&
            (typeof value.val === "string" || typeof value.val === "number" || typeof value.val === "boolean")
        ) {
            this.log.debug(`setLiveSettings: ${sn} - ${value.val} - ${attribut}`);
            this.livemapSettings[sn][attribut] = this.hexToRGBA(value.val);
        }
    },

    /**
     * Pick MQTT broker based on the FIRST device's model class. Mixed accounts
     * (V1 + S/X) connect through the wrong broker for the minority — pre-existing
     * limitation, not fixed in this refactor.
     *
     * @param {boolean} device
     */
    mqttBroker(device) {
        let V1 = false;
        let SXV = false;
        for (const meta of Object.values(this.deviceMeta)) {
            if (meta.modelClass === "V1") {
                V1 = true;
            } else {
                SXV = true;
            }
        }
        this.log.debug(`mqttBroker: ${V1 ? "true" : "false"} - ${SXV ? "true" : "false"}`);
        if (V1 && device) {
            return this.options.region === "US"
                ? { host: "app.mqttv1-us.sk-robot.com", port: 32884 }
                : { host: "app.mqttv1-eu.sk-robot.com", port: 32884 };
        } else if (device) {
            return null;
        }
        if (!SXV) {
            return null;
        }
        // Prefer the wirefree broker domain reported by /admin/user/app/info
        // (mqttWirefreeDomainName), exactly like the app; fall back to region.
        // if (this.mqttWirefreeDomain) {
        //     return { host: this.mqttWirefreeDomain, port: 31884 };
        // }
        return this.options.region === "US"
            ? { host: "wfsmqtts-specific-us.sk-robot.com", port: 31884 }
            : { host: "wfsmqtts-specific.sk-robot.com", port: 31884 };
    },

    /**
     * Initialization Meta
     *
     * @param {any} d
     * @returns {any}
     */
    _initDeviceMeta(d) {
        const modelClass = this.classifyModel(d.clientName);
        const gen = this.classifyGeneration(d.clientName);
        return {
            modelClass,
            gen,
            cmdurl: modelClass === "V1" ? CMDURL_V1 : CMDURL_SXV,
            deviceId: null,
            robotPos: null,
            share: false,
            lng: 0,
            lat: 0,
            profile: false,
            ownerAppUserId: d.ownerAppUserId,
            topUp: true,
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
            antiTheftSn: null,
            mapLon: null,
            mapLat: null,
            fenceRadiusSettingId: null,
            pattern: {
                LOGO_S: "LOGO_S",
                CIRCLE: "CIRCLE",
                FOUR_POINT_STAR: "FOUR_POINT_STAR",
                TRIANGLE: "TRIANGLE",
                HEART: "HEART",
                NUMB_0: "NUMB_0",
                NUMB_1: "NUMB_1",
                NUMB_2: "NUMB_2",
                NUMB_3: "NUMB_3",
                NUMB_4: "NUMB_4",
                NUMB_5: "NUMB_5",
                NUMB_6: "NUMB_6",
                NUMB_7: "NUMB_7",
                NUMB_8: "NUMB_8",
                NUMB_9: "NUMB_9",
                FIVE_POINT_STAR: "FIVE_POINT_STAR",
                FOOTBALL: "FOOTBALL",
                TROPHY: "TROPHY",
            },
            mapid: undefined,
            fw: d.firmware_version,
            fw_new: "",
            fw_base: "",
            fw_base_new: "",
            livemap: false,
            time_custom_flag: true,
            recommended_time_flag: false,
            time_zone: d.time_zone != null ? d.time_zone : 3600,
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
        const dev = this.devicesRaw[sn];
        if (!dev) {
            return;
        }
        //let apiPath = `/app_wireless_mower/work_record/page?sn=${sn}&current=${current}&size=${size}`;
        let apiPath = `/app_wireless_mower/message-send-logs/page/${String(dev.appUserId || this.session.user_id)}?ascFlag=false&current=${current}&size=${size}&sn=${sn}&sort=createdAt&type=2`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (json && json.data && json.data.records && Array.isArray(json.data.records)) {
            this.log.debug(`Device work records: ${JSON.stringify(json.data.records)}`);
            this.emit("event", { sn, data: json.data });
            //if (this.eventCodes) {
            //    for (const r of json.data.records) {
            //        if (r.startReason != null) {
            //            r.startReason = this.eventCodes[r.startReason];
            //        }
            //        if (r.endReason != null) {
            //            r.endReason = this.eventCodes[r.endReason];
            //        }
            //    }
            //}
            if (this.standalone) {
                await this.iob.setState(`${this.iob.namespace}.${sn}.events.events`, {
                    val: JSON.stringify(json.data.records),
                    ack: true,
                });
            }
        } else {
            try {
                this.log.debug(`Device record list is empty: ${JSON.stringify(json.data)}`);
            } catch (err) {
                this.emit("warn", "Device record list is empty!!", err);
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
        //let apiPath = `/app_wireless_mower/work_record/work_event_info/page?sn=${sn}&current=1&size=20&actualTime=true`;
        let apiPath = `/app_wireless_mower/work_record/work_event_info/page?sn=${sn}&current=1&size=10&actualTime=true&type=2`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (json && json.data && json.data.records && Array.isArray(json.data.records)) {
            this.log.debug(`Device notification: ${JSON.stringify(json.data.records)}`);
            this.emit("notify", { sn, data: json.data });
            if (this.eventCodes) {
                for (const r of json.data.records) {
                    if (r.code != null) {
                        r.code = this.eventCodes[r.code];
                    }
                }
                if (this.standalone) {
                    await this.iob.setState(`${sn}.events.eventNotification`, {
                        val: JSON.stringify(json.data.records),
                        ack: true,
                    });
                }
            }
        } else {
            try {
                this.log.debug(`Device notification list is empty: ${JSON.stringify(json.data)}`);
            } catch (err) {
                this.emit("warn", "Device notification list is empty!!", err);
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
        this.log.debug(`${name}: ${JSON.stringify(json)}`);
        json && this.emit("countUnreadMessage", { sn, name, data: json });
        if (json && typeof json.data === "number" && this.standalone) {
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
        //const apiPath = `/app_wireless_mower/message-send-logs/send/count/${String(dev.appUserId || this.session.user_id)}`;
        const apiPath = `/app_wireless_mower/message-send-logs/page/${String(dev.appUserId || this.session.user_id)}?ascFlag=false&current=1&size=20&sort=createdAt&type=1`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        this.log.debug(`systemmessage: ${JSON.stringify(json)}`);
        json && this.emit("systemMessage", { sn, data: json.data });
        if (json && json.data != null && typeof json.data === "object" && json.data.records && this.standalone) {
            await this.iob.setState(`${sn}.events.systemMessage`, {
                val: JSON.stringify(json.data.records),
                ack: true,
            });
            if (dev.ownerAppUserId) {
                return;
            }
            const states = {
                none: "none",
            };
            for (const message of json.data.records) {
                if (
                    message.messageTypeCode === "deviceInvite" &&
                    !this.inviteCheck24h(message.sendAt) &&
                    !states[message.sn]
                ) {
                    const obj = await this.iob.getObjectAsync(`${sn}.sharing.share_user.${message.id}`);
                    if (!obj) {
                        states[message.sn] = `${message.content}<time>${message.sendAt}`;
                    }
                }
            }
            await this.updateShareApplyInvite(sn, states, true);
        }
    },

    /**
     * @param {any} data
     */
    changeAttributeName(data) {
        if (data.electricity != null) {
            data["elec"] = data.electricity;
            delete data.electricity;
        }
        if (typeof data.wirelessDeviceSchedules === "object" && data.wirelessDeviceSchedules !== null) {
            delete data.wirelessDeviceSchedules;
        }
        if (data.aiRepairMap != null) {
            data["ai_repair_map"] = data.aiRepairMap;
            delete data.aiRepairMap;
        }
        if (data.autoUpgrade != null) {
            data["auto_upgrade"] = data.autoUpgrade;
            delete data.autoUpgrade;
        }
        //relo_status ??
        if (data.algoStatus != null) {
            data["algo_status"] = data.algoStatus;
            delete data.algoStatus;
        }
        if (data.userId != null) {
            data["appUserId"] = data.userId;
            delete data.userId;
        }
        if (data.ownerAppUserId != null) {
            data["appUserId"] = data.ownerAppUserId;
            delete data.ownerAppUserId;
        }
        if (data.wifiLv != null) {
            data["wifi_sig"] = data.wifiLv;
            delete data.wifiLv;
        }
        if (data.sn != null) {
            data["deviceSn"] = data.sn;
            delete data.sn;
        }
        if (data.buildMapStatus != null) {
            data["build_map_status"] = data.buildMapStatus;
            delete data.buildMapStatus;
        }
        if (data.ipAddr != null) {
            data["ip_addr"] = data.ipAddr;
            delete data.ipAddr;
        }
        if (data.net4gSig != null) {
            data["net_4g_sig"] = data.net4gSig;
            delete data.net4gSig;
        }
        if (data.laterUpgrade != null) {
            data["later_upgrade"] = data.laterUpgrade;
            delete data.laterUpgrade;
        }
        if (data.laterUpgradeFlag != null) {
            data["later_upgrade"] = data.laterUpgradeFlag;
            delete data.laterUpgradeFlag;
        }
        if (data.net4gStatus != null) {
            data["net_4g_status"] = data.net4gStatus;
            delete data.net4gStatus;
        }
        if (data.nrtkBase != null) {
            data["nrtk_base"] = data.nrtkBase;
            delete data.nrtkBase;
        }
        if (data.oneshotTaskType != null) {
            data["oneshot_task_type"] = data.oneshotTaskType;
            delete data.oneshotTaskType;
        }
        if (data.softModel != null) {
            data["soft_model"] = data.softModel;
            delete data.softModel;
        }
        if (data.taskType != null) {
            data["task_type"] = data.taskType;
            delete data.taskType;
        }
        if (data.textureMapFlag != null) {
            data["texture_map_flag"] = data.textureMapFlag;
            delete data.textureMapFlag;
        }
        if (data.firmwareVersion != null) {
            if (typeof data.firmwareVersion !== "number") {
                data["firmware_version"] = data.firmwareVersion;
            }
            delete data.firmwareVersion;
        }
        if (data.wirelessFirmwareVersion != null) {
            data["firmware_version"] = data.wirelessFirmwareVersion;
            delete data.wirelessFirmwareVersion;
        }
        if (data.deviceName != null) {
            data["dev_name"] = data.deviceName;
            delete data.deviceName;
        }
        if (data.name != null) {
            data["dev_name"] = data.name;
            delete data.name;
        }
        if (data.modelName != null) {
            data["clientName"] = data.modelName;
            delete data.modelName;
        }
        if (data.deviceModelName != null) {
            data["dev_model"] = data.deviceModelName;
            delete data.deviceModelName;
        }
        if (data.net4gFlag != null) {
            data["net_4g_status"] = data.net4gFlag;
            delete data.net4gFlag;
        }
        if (data.onlineFlag != null) {
            data["online"] = data.onlineFlag;
            delete data.onlineFlag;
        }
        if (data.deviceOnlineFlag != null) {
            data["online"] = data.deviceOnlineFlag;
            delete data.deviceOnlineFlag;
        }
        if (data.filterStatus != null) {
            data["filter_status"] = data.filterStatus;
            delete data.filterStatus;
        }
        if (data.ledFlag != null) {
            data["led"] = data.ledFlag;
            delete data.ledFlag;
        }
        if (data.wirelessTimeZone != null) {
            data["time_zone"] = data.wirelessTimeZone;
            delete data.wirelessTimeZone;
        }
        if (data.wirelessWorkStatusCode != null) {
            data["status"] = data.wirelessWorkStatusCode;
            delete data.wirelessWorkStatusCode;
        }
        if (data.workStatusCode != null) {
            data["status"] =
                typeof data.workStatusCode === "string" ? parseInt(data.workStatusCode) : data.workStatusCode;
            delete data.workStatusCode;
        }
        if (data.wirelessFaultStatusCode != null) {
            data["fault"] = data.wirelessFaultStatusCode;
            delete data.wirelessFaultStatusCode;
        }
        if (data.faultStatusCode != null) {
            data["fault"] =
                typeof data.faultStatusCode === "string" ? parseInt(data.faultStatusCode) : data.faultStatusCode;
            delete data.faultStatusCode;
        }
        if (data.smallCutterStatus != null) {
            data["small_cutter_status"] = data.smallCutterStatus;
            delete data.smallCutterStatus;
        }
        if (data.followBorderLaps != null) {
            data["follow_border_laps"] = data.followBorderLaps;
            delete data.followBorderLaps;
        }
        if (data.autoRideEdgeMapM != null) {
            data["auto_ride_edge_map_m"] = data.autoRideEdgeMapM;
            delete data.autoRideEdgeMapM;
        }
        if (data.rechargeMode != null) {
            data["recharge_mode"] = data.rechargeMode;
            delete data.rechargeMode;
        }
        if (data.followBorderFreq != null) {
            data["follow_border_freq"] = data.followBorderFreq;
            delete data.followBorderFreq;
        }
        if (data.energySavingMode != null) {
            data["energy_saving_mode"] = data.energySavingMode;
            delete data.energySavingMode;
        }
        if (data.rainCountdown != null) {
            if (!data["rain"]) {
                data["rain"] = {};
            }
            data["rain"]["rain_countdown"] = data.rainCountdown;
            delete data.rainCountdown;
        }
        if (data.rainDelayDuration != null) {
            if (!data["rain"]) {
                data["rain"] = {};
            }
            data["rain"]["delay"] = data.rainDelayDuration;
            delete data.rainDelayDuration;
        }
        if (data.rainFlag != null) {
            if (!data["rain"]) {
                data["rain"] = {};
            }
            data["rain"]["rain_flag"] = data.rainFlag;
            delete data.rainFlag;
        }
        if (data.rainStatusCode != null) {
            if (!data["rain"]) {
                data["rain"] = {};
            }
            data["rain"]["rain_status_code"] = data.rainStatusCode;
            delete data.rainStatusCode;
        }
        if (data.rain_status != null) {
            if (!data["rain"]) {
                data["rain"] = {};
            }
            data["rain"]["rain_status"] = data.rain_status;
            delete data.rain_status;
        }
        if (data.rainDelayLeft != null) {
            if (!data["rain"]) {
                data["rain"] = {};
            }
            data["rain"]["rain_delay_left"] = data.rainDelayLeft;
            delete data.rainDelayLeft;
        }
        if (data.autoUpgradeFlag != null) {
            data["auto_upgrade"] = data.autoUpgradeFlag;
            delete data.autoUpgradeFlag;
        }
        if (data.consumableItemsObject != null) {
            data["consumable_items"] = data.consumableItemsObject;
            delete data.consumableItemsObject;
        }
        if (data.scheduleInfoObject != null) {
            data["schedule_info"] = data.scheduleInfoObject;
            delete data.scheduleInfoObject;
        }
        if (data.currentWorkParam != null) {
            data["current_work_param"] = data.currentWorkParam;
            delete data.currentWorkParam;
        }
        if (data.clientModelName != null) {
            data["clientName"] = data.clientModelName;
            delete data.clientModelName;
        }
        if (data.daylightTimeFlag != null) {
            data["daylight_time_auto_set"] = data.daylightTimeFlag;
            delete data.daylightTimeFlag;
        }
        /**
        if (data. != null) {
            data[""] = data.;
            delete data.;
        }
         */
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
            //{"timestamp":1789394497794,"path":"/app_wireless_mower/device-user/getCustomDevice","status":503,"error":"Service Unavailable","message":"Unable to find instance for xulian-biz-app-wireless-mower"}
            this.emit("devices", { devices: [] });
            return [];
        }
        let owner = [];
        let resp = null;
        if (this.options.apptype !== "Old") {
            const apiPathDevice = `/app_wireless_mower/device-user/getCustomDevice/page?current=1&size=20`;
            resp = await this.request("GET", apiPathDevice, {
                "Content-Type": "application/json",
                ...this.authHeaders(),
            });
            if (
                resp &&
                resp.json &&
                resp.json.data &&
                resp.json.data.records &&
                Array.isArray(resp.json.data.records)
            ) {
                owner = resp.json.data.records;
            }
            this.log.debug(`share data: ${JSON.stringify(resp.json)}`);
        }
        if (json.data.length > 1) {
            this.topUp = true;
            this.log.debug(`getDevices: Found ${json.data.length} devices`);
        } else {
            this.log.debug(`getDevices: Found ${json.data.length} device`);
        }
        this.log.debug(`getDevices data: ${JSON.stringify(json.data)}`);
        let topUp = true;
        this.topUpArrayDeviceSn = [];
        for (const d of json.data) {
            this.changeAttributeName(d);
            this.topUpArrayDeviceSn.push(d.deviceSn);
            let sn = d.deviceSn;
            if (this.standalone) {
                sn = d.deviceSn.replace(this.iob.FORBIDDEN_CHARS, "_");
            }
            this.devicesId[d.deviceId] = sn;
            const own = owner.find(m => m.deviceSn == d.deviceSn);
            if (own && typeof own.ownerAppUserId === "number") {
                d["ownerAppUserId"] = own.ownerAppUserId;
                d["appUserId"] = own.appUserId;
                this.log.info(`Found sharing device ${d.deviceSn} - ${own.deviceName}`);
            }
            this.devicesRaw[sn] = d;
            this.deviceMeta[sn] = this._initDeviceMeta(d);
            this.log.debug(`SN: ${sn} - ${topUp}`);
            this.deviceMeta[sn].topUp = topUp;
            if ((this.deviceMeta[sn].modelClass === "S" || this.deviceMeta[sn].modelClass === "X") && this.standalone) {
                const obj = await this.iob.getObjectAsync(`${this.iob.namespace}.${sn}.profile`);
                if (obj) {
                    this.deviceMeta[sn].profile = true;
                }
            }
            topUp = false;
            if (this.standalone) {
                if (typeof d.picUrl === "string" && d.picUrl.startsWith("http")) {
                    d["picUrlData"] = await this.getImage(d.picUrl, sn, "mower");
                }
                if (typeof d.picUrlDetail === "string" && d.picUrlDetail.startsWith("http")) {
                    d["picUrlDetailData"] = await this.getImage(d.picUrlDetail, sn, "mowerDetail");
                }
            }
            this.deviceMeta[sn].sid = this.randomString(16);
            if (this.standalone) {
                const sid = await this.iob.getStateAsync(`${sn}.mower_raw.iobroker_sid`);
                if (sid && typeof sid.val === "string" && sid.val != "") {
                    this.deviceMeta[sn].sid = sid.val;
                } else {
                    const common = {
                        name: d.dev_name || sn,
                        icon: d["picUrlData"] != null ? d["picUrlData"] : "img/mower.png",
                        desc: "Create by Adapter",
                        statusStates: {
                            onlineId: `${this.iob.namespace}.${sn}.mower_raw.online`,
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
                                desc: "Create by Adapter",
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
                                val: this.deviceMeta[sn].sid,
                                ack: true,
                            });
                        })
                        .catch((/** @type {{ name: any; message: any; }} */ error) => {
                            this.emit("error", `SID: ${error.name}`, error);
                        });
                }
            }
            this.log.info(`Device: sn=${sn} model=${d.clientName} name=${d.dev_name}`);
            if (this.deviceMeta[sn].modelClass === "S" && this.standalone) {
                await this.createLivemapSettings(sn);
                await this.readLivemapSettings(sn);
            }
        }
        this.emit("devices", { devices: json.data });
        for (const d of owner) {
            this.changeAttributeName(d);
        }
        this.emit("devicesList", { devices: owner });
        return json.data;
    },

    /**
     * Check account device list.
     */
    async getUpdateDevices() {
        this.log.debug(`Start check device list`);
        const apiPath =
            this.options.apptype === "Old"
                ? "/mower/device-user/list"
                : "/app_wireless_mower/device-user/getCustomDevice?all=true";
        this.log.debug(`getUpdateDevices: ${apiPath}`);
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (!Array.isArray(json.data)) {
            this.log.debug(`Device list empty: ${JSON.stringify(json)}`);
            return [];
        }
        this.log.debug(`getUpdateDevices data: ${JSON.stringify(json.data)}`);
        let topUp = true;
        this.topUpArrayDeviceSn = [];
        for (const d of json.data) {
            this.changeAttributeName(d);
            this.topUpArrayDeviceSn.push(d.deviceSn);
            let sn = d.deviceSn;
            if (this.standalone) {
                sn = d.deviceSn.replace(this.iob.FORBIDDEN_CHARS, "_");
            }
            const meta = this.deviceMeta[sn];
            if (!meta) {
                this.log.error(`Device ${sn} unknown! Please restart adapter!`);
                return;
            }
            this.log.debug(`SN: ${sn} - ${topUp}`);
            meta.topUp = topUp;
            topUp = false;
        }
        this.emit("updateDevices", { devices: json.data });
        return true;
    },

    async getUpdateSharing() {
        if (this.options.apptype === "Old") {
            return;
        }
        const apiPath = `/app_wireless_mower/device-user/getCustomDevice/page?current=1&size=20`;
        const { json } = await this.request("GET", apiPath, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        this.log.debug(`getUpdateSharing data: ${JSON.stringify(json.data)}`);
        if (json && json.data && json.data.records && Array.isArray(json.data.records)) {
            for (const d of json.data.records) {
                this.changeAttributeName(d);
                const sn = d.deviceSn.replace(this.iob.FORBIDDEN_CHARS, "_");
                const meta = this.deviceMeta[sn];
                if (!meta) {
                    this.log.error(`Device ${sn} unknown! Please restart adapter!`);
                    return;
                }
            }
            if (json.data.records.length > 1) {
                this.topUp = true;
            } else {
                this.topUp = false;
            }
        } else {
            this.topUp = false;
        }
        this.emit("devicesList", { devices: json.data });
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
            this.log.error(`ICON ERROR: ${JSON.stringify(resp)}`);
            return null;
        }
        const { file, mimeType } = await this.iob.readFileAsync(this.iob.namespace, `${sn}/${name}.png`);
        if (file && mimeType) {
            const mime = Buffer.from(file).toString("base64");
            return `data:${mimeType};base64,${mime}`;
        }
        return null;
    },

    /**
     * @param {number} timestamp
     */
    inviteCheck24h(timestamp) {
        timestamp = timestamp * 1000;
        const one_day = 24 * 60 * 60 * 1000;
        const actual = Date.now();
        return actual - timestamp > one_day;
    },
};

module.exports.CMDURL_SXV = CMDURL_SXV;
module.exports.CMDURL_V1 = CMDURL_V1;
