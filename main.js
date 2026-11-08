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
const objectName = require("./lib/objectname");

const ERRORTYPE_LABELS = {
    0: "normal",
    2: "Trapped",
    16: "No border",
    32: "Started outside border",
    262144: "Charging power to high",
};

const LOC_STATUS = {
    1: "Relocation",
    2: "Location",
};

const ALGO_STATUS = {
    0: "Route calculated",
    1: "Position determined",
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
        this.on("message", this.onMessage.bind(this));

        this.json2iob = new Json2iob(this);
        /** @type {Sunseeker | null} */
        this.sunseeker = null;
        this.updateDeviceSet = null;
        this.updateDeviceStateChange = null;
        this.createObjectDone = {};
        this.firstStart = {};
        this.wifi = [];
        this.firstStartTimeout = null;
        this.availableMaps = null;
        this.regionsCounter = {};
        this.regionId = {};
        this.notice = {};
        this.changeMail = {
            appType: 3,
            appVersion: "",
            code: "",
            newUserName: "",
            operatingSystemCode: "android",
            randomStr: "",
        };
        this.patternTimeout = {};
        this.restartLimit = {
            restartCount: 0,
            restartLast: 0,
            restartTime: "",
            day: "01-01",
        };
    }

    async onReady() {
        //ToDo getSchedule device S or X use getTimes
        //ToDo Multiple MQTT connections (V! + new + old)
        //ToDo Forced internet disconnection - Add rate limit
        //ToDo Wrong start_reason & end_reason
        //ToDo Other interval for getDevAllProperty
        //ToDo Add Pattern size
        this.setState("info.connection", false, true);

        const resCount = await this.getStateAsync(`rateLimit.restart`);
        if (resCount && resCount.val != null && typeof resCount.val === "string" && resCount.val.startsWith("{")) {
            const infoCount = JSON.parse(resCount.val);
            if (Object.keys(infoCount).length === 4) {
                this.log.debug(`Use old restartLimit data!`);
                this.restartLimit = infoCount;
            }
        }
        const reqCount = await this.getStateAsync(`rateLimit.request`);
        if (reqCount && reqCount.val != null && typeof reqCount.val === "string" && reqCount.val.startsWith("{")) {
            const infoCounts = JSON.parse(reqCount.val);
            if (Object.keys(infoCounts).length === 6) {
                this.log.debug(`Use old requestLimit data!`);
                this.config.request = infoCounts;
            }
        }
        let diffTime = new Date().getTime() - this.restartLimit.restartLast;
        const actualWeek = this.getWeek();
        if (diffTime > 24 * 60 * 1000 * 60 || this.restartLimit.day != actualWeek) {
            this.restartLimit.restartCount = 0;
            this.restartLimit.restartLast = new Date().getTime();
            this.restartLimit.restartTime = new Date().toISOString();
            this.restartLimit.day = actualWeek;
        }
        diffTime = new Date().getTime() - this.config.request.requestLast;
        if (diffTime > 24 * 60 * 1000 * 60 || this.config.request.day != actualWeek) {
            this.config.request.requestCount = 0;
            this.config.request.requestLast = new Date().getTime();
            this.config.request.requestTime = new Date().toISOString();
            this.config.request.request = [];
            this.config.request.requestBlock = false;
            this.config.request.day = actualWeek;
        }
        if (this.config.request.requestBlock) {
            if (this.config.request.requestCount < this.config.ratelimit) {
                this.config.request.requestBlock = true;
            } else {
                this.log.warn(`The request limit of ${this.config.ratelimit} per day has been reached.`);
                return;
            }
        }
        if (this.restartLimit.restartCount > this.config.restartlimit) {
            this.log.warn(`The restart limit of ${this.config.restartlimit} per day has been reached.`);
            return;
        }
        ++this.restartLimit.restartCount;
        await this.setRestartCount();

        if (this.config.restartlimit < 0 || this.config.restartlimit > 10) {
            this.log.warn(`Restartlimit changed! ${this.config.restartlimit}`);
            this.config.restartlimit = 5;
        }

        if (this.config.errorlimit < 0 || this.config.errorlimit > 10) {
            this.log.warn(`Errorlimit changed! ${this.config.errorlimit}`);
            this.config.errorlimit = 5;
        }

        const cfg = this.config;
        if (!cfg.username || !cfg.password) {
            this.log.error("Please set the username and password in the adapter settings.");
            return;
        }

        let isPWChanged = false;
        const instance = await this.getObjectAsync("auth.session");
        if (instance && instance.native && instance.native.password != "") {
            if (
                this.config.username != instance.native.username ||
                this.config.password != this.decrypt(instance.native.password)
            ) {
                this.log.debug(`User and password have been changed!`);
                isPWChanged = true;
            }
            if (this.config.region != instance.native.region || this.config.language != instance.native.language) {
                this.log.debug(`Region and language have been changed!`);
                isPWChanged = true;
            }
        }

        await this.sessionCheck();

        await this.sessionCheckMqtt();

        if (typeof this.config.mqtt_pw === "string" && this.config.mqtt_pw.length > 10) {
            //ToDo Check how long is the password valid?
            this.log.debug(`Use old Mqtt PW!`);
        }

        if (isPWChanged) {
            this.config.mqtt_pw = "";
            this.config.session["action"] = 0;
        }

        this.sunseeker = new Sunseeker(
            cfg.username,
            cfg.password,
            {
                region: cfg.region || "EU",
                apptype: cfg.apptype || "New",
                language: cfg.language || "de-DE",
                interval: Number(cfg.interval) > 59 && Number(cfg.interval) < 1441 ? Number(cfg.interval) : 300,
                refreshAfterMqttMs: 60 * 1000,
            },
            this,
        );

        await this.createAuth();

        if (isPWChanged) {
            this.setSession();
            isPWChanged = false;
        }

        this.sunseeker.on("devices", payload => this.onSunseekerDevices(payload));
        this.sunseeker.on("devicesList", payload => this.onSunseekerDevicesList(payload));
        this.sunseeker.on("updateDevices", payload => this.onSunseekerUpdateDevices(payload));
        this.sunseeker.on("records", payload => this.onSunseekerRecords(payload));
        this.sunseeker.on("status", payload => this.onSunseekerStatus(payload));
        this.sunseeker.on("zigzag", payload => this.onSunseekerMultiZigZag(payload));
        this.sunseeker.on("customZigzag", payload => this.onSunseekerCustomMultiZigZag(payload));
        this.sunseeker.on("notice", payload => this.onSunseekerNotice(payload));
        this.sunseeker.on("mqtt", payload => this.onSunseekerMqtt(payload));
        this.sunseeker.on("objectExists", payload => this.onSunseekerObjectExists(payload));
        this.sunseeker.on("deleteObjectExists", payload => this.onSunseekerDeleteObjectExists(payload));
        this.sunseeker.on("map", payload => this.onSunseekerMap(payload));
        this.sunseeker.on("livemap", payload => this.onSunseekerLivemap(payload));
        this.sunseeker.on("firmware", payload => this.onSunseekerFirmware(payload));
        this.sunseeker.on("mqttConnect", () => this.setState("info.connection", true, true));
        this.sunseeker.on("mqttDisconnect", () => this.setState("info.connection", false, true));
        this.sunseeker.on("error", (text, err) => this.log.error(`${text}: ${err.message || String(err)}`));
        this.sunseeker.on("warn", (text, err) => this.log.warn(`${text}: ${err.message || String(err)}`));
        this.sunseeker.on("own", payload => this.onSunseekerOwn(payload));
        this.sunseeker.on("mqtt_auth", payload => this.onSunseekerMqttAuth(payload));
        this.sunseeker.on("mqtt_status", (objectId, val) => this.onSunseekerMqttStatus(objectId, val));
        this.sunseeker.on("mqtt_counter", payload => this.onSunseekerMqttCounter(payload));
        this.sunseeker.on("session", payload => this.onSunseekerSession(payload));
        this.sunseeker.on("mode", payload => this.onSunseekerScheduleMode(payload));
        this.sunseeker.on("fence", payload => this.onSunseekerFenceSettings(payload));
        this.sunseeker.on("theft", payload => this.onSunseekerInfoTheft(payload));
        this.sunseeker.on("position", payload => this.onSunseekerInfoPosition(payload));
        this.sunseeker.on("clearCache", payload => this.onSunseekerClearJson2iobCache(payload));
        this.sunseeker.on("previewmap", payload => this.onSunseekerPreviewMap(payload));
        this.sunseeker.on("sharing", (sn, data) => this.onSunseekerSharingUser(sn, data));
        this.sunseeker.on("mqttInvite", (sn, data) => this.onSunseekerInviteCheck(sn, data));
        this.sunseeker.on("deviceSettingsState", (sn, data) => this.onSunseekerDeviceSettingsState(sn, data));
        this.sunseeker.on("wifi", payload => this.onSunseekerWifi(payload));
        this.sunseeker.on("appInfo", data => this.onSunseekerAppInfo(data));
        //this.sunseeker.on("event", payload => this.onSunseekerEvent(payload));
        //this.sunseeker.on("notify", payload => this.onSunseekerNotify(payload));
        //this.sunseeker.on("countUnreadMessage", payload => this.onSunseekerCountUnread(payload));
        //this.sunseeker.on("systemMessage", payload => this.onSunseekerSystemMessage(payload));
        //this.sunseeker.on("skin", payload => this.onSunseekerSkin(payload));
        //this.sunseeker.on("limit", payload => this.onSunseekerRequestLimit(payload));
        //this.sunseeker.on("communities", payload => this.onSunseekerCommunities(payload));
        //this.sunseeker.on("agreements", payload => this.onSunseekerAgreements(payload));
        //this.sunseeker.on("settingsX", payload => this.onSunseekerSettingsX(payload));
        //this.sunseeker.on("getTime", payload => this.onSunseekerGetTime(payload));
        //this.sunseeker.on("appRelease", payload => this.onSunseekerAppRelease(payload));
        //this.sunseeker.on("errorMessage", payload => this.onSunseekerErrorMessage(payload));

        this.subscribeStates("*");

        try {
            const start = await this.sunseeker.start();
            if (!start) {
                this.log.warn(`Cannot found device!!`);
                return;
            }
        } catch (err) {
            this.log.error(`Start failed: ${err.message}`);
            return;
        }
        this.setState("info.connection", true, true);
        try {
            await this.sunseeker.updateAllDevices(false);
        } catch (err) {
            this.log.warn(`Initial-Update: ${err.message}`);
        }
        this.checkDeviceObjectTree();
    }

    async sessionCheckMqtt() {
        const obj = await this.getObjectAsync("auth.session");
        if (obj) {
            const mqtt = await this.getStateAsync("auth.mqtt_connection");
            if (
                mqtt != null &&
                mqtt.val != null &&
                typeof mqtt.val === "string" &&
                mqtt.val.startsWith("{") &&
                mqtt.val != "" &&
                mqtt.val.length > 10
            ) {
                try {
                    const val = JSON.parse(mqtt.val);
                    if (val && typeof val.pw === "string" && val.pw.length > 10) {
                        this.config.mqtt_pw = this.decrypt(val.pw);
                    }
                } catch {
                    return;
                }
            }
        }
    }

    async sessionCheck() {
        const obj = await this.getObjectAsync("auth.session");
        if (obj) {
            const check_key = await this.getStateAsync("auth.session");
            if (
                check_key != null &&
                check_key.val != null &&
                typeof check_key.val === "string" &&
                check_key.val.startsWith("{") &&
                check_key.val != "" &&
                check_key.val.length > 10
            ) {
                try {
                    const val = JSON.parse(check_key.val);
                    val.access_token = this.decrypt(val.access_token);
                    val.refresh_token = this.decrypt(val.refresh_token);
                    const actual = new Date().getTime();
                    this.log.debug(`Old session ${check_key.val}`);
                    if (val && val.next > actual) {
                        this.log.debug(`Use old session!`);
                        const diff = val.next - actual;
                        if (diff < 500) {
                            val.action = 1;
                        } else {
                            val.action = diff;
                        }
                    } else if (val && val.next < actual && val.next_refresh > actual) {
                        this.log.debug(`Use old session!`);
                        val.action = 1;
                    }
                    this.config.session = val;
                } catch {
                    return;
                }
            }
        }
        return;
    }

    setSession() {
        this.extendObject("auth.session", {
            native: {
                username: this.config.username,
                password: this.encrypt(this.config.password),
                region: this.config.region,
                language: this.config.language,
            },
        });
    }

    async checkDeviceObjectTree() {
        try {
            this.log.info(`Start check devices object!`);
            const devices = await this.getDevicesAsync();
            for (const element of devices) {
                const id = element["_id"].split(".").pop();
                if (this.regionsCounter[id]) {
                    this.log.debug(`Found device ${element["_id"]}`);
                } else {
                    this.log.warn(
                        `Serial number ${id} was not found. Please delete the object tree ${element["_id"]}.`,
                    );
                    //await this.delObjectAsync(`${id}`, { recursive: true });
                }
            }
        } catch (e) {
            this.log.error(`checkDeviceFolder: ${e}`);
        }
    }

    /**
     * @param {ioBroker.Message} obj
     */
    async onMessage(obj) {
        if (typeof obj === "object" && obj.message) {
            switch (obj.command) {
                case "createOwnRequest":
                    if (obj.message && obj.message.parameter && obj.message.parameter != "" && this.sunseeker) {
                        if (!this.sunseeker.devicesRaw[obj.message.parameter]) {
                            this.log.warn(`createOwnRequest: Device ${obj.message.parameter} unknown`);
                            if (obj.callback) {
                                this.sendTo(
                                    obj.from,
                                    obj.command,
                                    [{ info: `Device ${obj.message.parameter} unknown` }],
                                    obj.callback,
                                );
                            }
                            return;
                        }
                        this.sunseeker.ensureOwnRequestStates(obj.message.parameter);
                        if (obj.callback) {
                            this.sendTo(obj.from, obj.command, [{ info: "OK" }], obj.callback);
                        }
                    } else {
                        if (obj.callback) {
                            this.sendTo(obj.from, obj.command, [{ info: "Error" }], obj.callback);
                        }
                    }
                    break;
                case "createProfile":
                    if (obj.message && obj.message.parameter && obj.message.parameter != "" && this.sunseeker) {
                        if (obj.message.parameter != "unhide") {
                            this.log.warn(`createProfile: ${obj.message.parameter} unknown`);
                            if (obj.callback) {
                                this.sendTo(
                                    obj.from,
                                    obj.command,
                                    [{ info: `${obj.message.parameter} unknown` }],
                                    obj.callback,
                                );
                            }
                            return;
                        }
                        this.sunseeker.ensureProfileStates();
                        if (obj.callback) {
                            this.sendTo(obj.from, obj.command, [{ info: "OK" }], obj.callback);
                        }
                    } else {
                        if (obj.callback) {
                            this.sendTo(obj.from, obj.command, [{ info: "Error" }], obj.callback);
                        }
                    }
                    break;
                case "createProfileSN":
                    if (obj.message && obj.message.parameter && obj.message.parameter != "" && this.sunseeker) {
                        if (!this.sunseeker.devicesRaw[obj.message.parameter]) {
                            this.log.warn(`createProfileSN: Device ${obj.message.parameter} unknown`);
                            if (obj.callback) {
                                this.sendTo(
                                    obj.from,
                                    obj.command,
                                    [{ info: `Device ${obj.message.parameter} unknown` }],
                                    obj.callback,
                                );
                            }
                            return;
                        }
                        this.sunseeker.ensureProfileStatesSN(obj.message.parameter);
                        this.sunseeker.setProfile(obj.message.parameter);
                        if (obj.callback) {
                            this.sendTo(obj.from, obj.command, [{ info: "OK" }], obj.callback);
                        }
                    } else {
                        if (obj.callback) {
                            this.sendTo(obj.from, obj.command, [{ info: "Error" }], obj.callback);
                        }
                    }
                    break;
                default:
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, [{ info: "Error" }], obj.callback);
                    }
            }
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {() => void} callback - Callback function
     */
    async onUnload(callback) {
        try {
            await this.setState("info.connection", false, true);
            await this.setState("auth.mqtt_connected", false, true);
            await this.setState("auth.mqtt_connected_V1", false, true);
            await this.setState("auth.mqtt_connected_old", false, true);
            if (this.sunseeker) {
                this.sunseeker.stop();
                this.sunseeker = null;
            }
            this.firstStartTimeout && this.clearTimeout(this.firstStartTimeout);
            this.updateDeviceSet && this.clearTimeout(this.updateDeviceSet);
            this.updateDeviceStateChange && this.clearTimeout(this.updateDeviceStateChange);
            for (const sn in this.patternTimeout) {
                if (this.patternTimeout[sn]) {
                    this.clearTimeout(this.patternTimeout[sn]);
                }
            }
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
            0: `${meta && (meta.modelClass === "X" || meta.modelClass === "S") ? "unknown" : "standby"}`,
            1: `${meta && (meta.modelClass === "X" || meta.modelClass === "S") ? "idle" : "mowing"}`,
            2: `${meta && (meta.modelClass === "X" || meta.modelClass === "S") ? "working" : "going home"}`,
            3: `${meta && (meta.modelClass === "X" || meta.modelClass === "S") ? "pause" : "charging"}`,
            4: "unknown",
            5: "unknown",
            6: "error",
            7: `${meta && (meta.modelClass === "X" || meta.modelClass === "S") ? "return" : "mowing border"}`,
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
            fault: { ...ERRORTYPE_LABELS },
            status: states,
            relo_status: LOC_STATUS,
            algo_status: ALGO_STATUS,
        };
    }

    /**
     * @param {string} path
     */
    onSunseekerObjectExists(path) {
        this.createObjectDone[path] = true;
    }

    /**
     * @param {string} path
     */
    onSunseekerDeleteObjectExists(path) {
        if (this.createObjectDone[path]) {
            delete this.createObjectDone[path];
        }
    }

    async onSunseekerFenceSettings({ sn, fence }) {
        if (!Array.isArray(fence) || !this.sunseeker) {
            this.log.warn(`Fence is not array!!`);
            return;
        }
        const pos = {};
        for (const fence_single of fence) {
            if (fence_single.id != null) {
                pos[fence_single.id] = fence_single.name;
            }
        }
        let common;
        if (Object.keys(pos).length > 0) {
            common = {
                name: {
                    en: "Fence range",
                    de: "Zaunbereich",
                    ru: "Диапазон ограждения",
                    pt: "Faixa de cercas",
                    nl: "Hekwerkbereik",
                    fr: "Gamme de clôtures",
                    it: "Recinto di recinzione",
                    es: "Gama de vallas",
                    pl: "Zakres ogrodzenia",
                    uk: "Асортимент парканів",
                    "zh-cn": "围栏范围",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                min: 1,
                max: 3,
                def: 1,
                states: pos,
            };
            await this.sunseeker.createDataPoint(
                `${this.namespace}.${sn}.antiTheft.fence`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        common = {
            name: {
                en: "Digital fence",
                de: "Digitaler Zaun",
                ru: "Цифровой забор",
                pt: "Cerca digital",
                nl: "Digitale omheining",
                fr: "Clôture numérique",
                it: "Recinzione digitale",
                es: "Valla digital",
                pl: "Cyfrowe ogrodzenie",
                uk: "Цифрова огорожа",
                "zh-cn": "数字围栏",
            },
            type: "boolean",
            role: "switch",
            write: true,
            read: true,
            def: false,
        };
        await this.sunseeker.createDataPoint(
            `${this.namespace}.${sn}.antiTheft.fence_digital`,
            common,
            "state",
            null,
            null,
            null,
        );
    }

    /**
     * @param {any} payload
     */
    async onSunseekerMqttCounter(payload) {
        await this.setState(`auth.mqtt_count`, { val: JSON.stringify(payload), ack: true });
    }

    async onSunseekerInfoTheft({ sn, theft }) {
        if (theft.fenceRadiusSettingId != null) {
            await this.setState(`${sn}.antiTheft.fence`, { val: Number(theft.fenceRadiusSettingId), ack: true });
            delete theft.fenceRadiusSettingId;
        }
        if (theft.fenceStatus != null) {
            const val = theft.fenceStatus == 1 ? true : false;
            await this.setState(`${sn}.antiTheft.fence_digital`, { val: val, ack: true });
            delete theft.fenceStatus;
        }
        const cleanup = this.removeNull(theft);
        await this.json2iob.parse(`${sn}.antiTheft`, cleanup, {
            channelName: {
                en: "Anti-Theft",
                de: "Diebstahlschutz",
                ru: "Противоугонная система",
                pt: "Antifurto",
                nl: "Diefstalbeveiliging",
                fr: "Système antivol",
                it: "Antifurto",
                es: "Sistema antirrobo",
                pl: "Antykradzieżowy",
                uk: "Антикрадіжка",
                "zh-cn": "防盗",
            },
            forceIndex: true,
            roles: {
                fenceCenterLon: "value.gps.latitude",
                fenceCenterLat: "value.gps.latitude",
                batteryVoltage: "value.battery",
            },
            units: {
                batteryVoltage: "V",
            },
        });
    }

    async onSunseekerInfoPosition({ sn, pos }) {
        if (!pos) {
            this.log.debug(`No Anti-Theft data!`);
            return;
        }
        const cleanup = this.removeNull(pos);
        await this.json2iob.parse(`${sn}.antiTheft`, cleanup, {
            channelName: {
                en: "Anti-Theft",
                de: "Diebstahlschutz",
                ru: "Противоугонная система",
                pt: "Antifurto",
                nl: "Diefstalbeveiliging",
                fr: "Système antivol",
                it: "Antifurto",
                es: "Sistema antirrobo",
                pl: "Antykradzieżowy",
                uk: "Антикрадіжка",
                "zh-cn": "防盗",
            },
            forceIndex: true,
            roles: {
                lon: "value.gps.latitude",
                lat: "value.gps.latitude",
                mapLon: "value.gps.latitude",
                mapLat: "value.gps.latitude",
            },
        });
    }

    async onSunseekerUpdateDevices({ devices }) {
        if (!Array.isArray(devices)) {
            return;
        }
        for (const d of devices) {
            const sn = d.deviceSn.replace(this.FORBIDDEN_CHARS, "_");
            const path = `${sn}.mower_raw`;
            const cleanup = this.removeNull(d);
            if (cleanup.multi_zigzag_angles) {
                delete cleanup.multi_zigzag_angles;
            }
            if (cleanup.plan_angle) {
                delete cleanup.plan_angle;
            }
            if (cleanup.area_info) {
                delete cleanup.area_info;
            }
            await this.json2iob.parse(path, cleanup, {
                channelName: {
                    en: "All data from cloud and mqtt",
                    de: "Alle Daten aus der Cloud und MQTT",
                    ru: "Все данные поступают из облака и MQTT.",
                    pt: "Todos os dados da nuvem e do MQTT",
                    nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                    fr: "Toutes les données proviennent du cloud et de MQTT.",
                    it: "Tutti i dati dal cloud e MQTT",
                    es: "Todos los datos provienen de la nube y MQTT.",
                    pl: "Wszystkie dane z chmury i MQTT",
                    uk: "Всі дані з хмари та mqtt",
                    "zh-cn": "所有数据均来自云端和 MQTT",
                },
                forceIndex: true,
                roles: objectName.MOWER_RAW_MQTT_ROLES,
                units: objectName.MOWER_RAW_MQTT_UNITS,
                descriptions: objectName.MOWER_RAW_MQTT,
            });
        }
    }

    async onSunseekerWifi({ sn, data }) {
        if (!data || !data.data || !Array.isArray(data.data) || !this.sunseeker) {
            return;
        }
        const cleanup = this.removeNull(data.data);
        await this.json2iob.parse(`${sn}.profile.wifi`, cleanup, {
            channelName: {
                en: "Wifi information",
                de: "WLAN-Informationen",
                ru: "Информация о Wi-Fi",
                pt: "Informações sobre Wi-Fi",
                nl: "Wifi-informatie",
                fr: "Informations sur le Wi-Fi",
                it: "Informazioni sul Wi-Fi",
                es: "Información sobre wifi",
                pl: "Informacje o Wi-Fi",
                uk: "Інформація про Wi-Fi",
                "zh-cn": "无线网络信息",
            },
            forceIndex: true,
        });
        if (cleanup.length < this.wifi.length) {
            const obj = await this.loadChannels(sn, `profile.wifi.`, true);
            const obj_wifi = Object.keys(obj).length;
            const new_wifi = Object.keys(cleanup).length;
            let count = obj_wifi;
            let save = 0;
            for (let a = new_wifi; a <= obj_wifi - 1; a++) {
                this.log.info(`Delete wifi: ${this.namespace}.${sn}.profile.wifi.${`0${count}`.slice(-2)}`);
                await this.delObjectAsync(`${this.namespace}.${sn}.profile.wifi.${`0${count}`.slice(-2)}`, {
                    recursive: true,
                });
                this.json2iob.resetCache(`${sn}.profile.wifi.${`0${count}`.slice(-2)}`);
                --count;
                ++save;
                if (save > 10) {
                    break;
                }
            }
        } else {
            this.wifi = cleanup;
        }
    }

    async onSunseekerDevicesList({ devices }) {
        if (!devices || !Array.isArray(devices.records) || !this.sunseeker) {
            return;
        }
        for (const d of devices.records) {
            const sn = d.deviceSn.replace(this.FORBIDDEN_CHARS, "_");
            const cleanup = this.removeNull(d);
            if (cleanup.ownerAppUserId) {
                const data = {
                    ownerAppUserId: cleanup.ownerAppUserId,
                };
                await this.json2iob.parse(`${sn}.mower_raw`, data, {
                    channelName: {
                        en: "All data from cloud and mqtt",
                        de: "Alle Daten aus der Cloud und MQTT",
                        ru: "Все данные поступают из облака и MQTT.",
                        pt: "Todos os dados da nuvem e do MQTT",
                        nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                        fr: "Toutes les données proviennent du cloud et de MQTT.",
                        it: "Tutti i dati dal cloud e MQTT",
                        es: "Todos los datos provienen de la nube y MQTT.",
                        pl: "Wszystkie dane z chmury i MQTT",
                        uk: "Всі дані з хмари та mqtt",
                        "zh-cn": "所有数据均来自云端和 MQTT",
                    },
                    forceIndex: true,
                });
            }
        }
    }

    async onSunseekerDevices({ devices }) {
        if (!Array.isArray(devices)) {
            return;
        }
        let common;
        for (const d of devices) {
            const sn = d.deviceSn.replace(this.FORBIDDEN_CHARS, "_");
            this.patternTimeout[sn] = null;
            this.regionId[sn] = [];
            if (!this.regionsCounter[sn]) {
                this.regionsCounter[sn] = {
                    passage: 0,
                    forbidden: 0,
                    obstacle: 0,
                    placed: 0,
                    work: 0,
                    blank: 0,
                };
            }
            let path = "";
            if (this.sunseeker) {
                common = {
                    name: d.dev_name || sn,
                    icon: d["picUrlData"] != null ? d["picUrlData"] : "img/mower.png",
                    desc: "Create by Adapter",
                    statusStates: {
                        onlineId: `${this.namespace}.${sn}.mower_raw.online`,
                    },
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${sn}`, common, "device", null, true, null);
                if (!this.createObjectDone["ensureScheduleStates"]) {
                    this.createObjectDone["ensureScheduleStates"] = true;
                    await this.sunseeker.ensureScheduleStates(sn);
                }
                await this.sunseeker.createSettingsFW(sn);
                const meta = this.sunseeker.deviceMeta[sn];
                if (meta && (meta.modelClass === "S" || d.modelClass === "X")) {
                    path = `${sn}.map`;
                    if (!this.createObjectDone[path]) {
                        this.createObjectDone[path] = true;
                        common = {
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
                            icon: "img/map.png",
                            desc: "Create by Adapter",
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${path}`,
                            common,
                            "channel",
                            null,
                            null,
                            null,
                        );
                        common = {
                            name: {
                                en: "Zones",
                                de: "Zonen",
                                ru: "Зоны",
                                pt: "Zonas",
                                nl: "Zones",
                                fr: "Zones",
                                it: "Zone",
                                es: "Zonas",
                                pl: "Strefy",
                                uk: "Зони",
                                "zh-cn": "Zones",
                            },
                            icon: "img/zone.png",
                            desc: "Create by Adapter",
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${path}.zones`,
                            common,
                            "channel",
                            null,
                            null,
                            null,
                        );
                        await this.sunseeker.addSharing(sn);
                        common = {
                            name: {
                                en: "Pattern",
                                de: "Muster",
                                ru: "Шаблон",
                                pt: "Padrão",
                                nl: "Patroon",
                                fr: "Modèle",
                                it: "Modello",
                                es: "Patrón",
                                pl: "Wzór",
                                uk: "Візерунок",
                                "zh-cn": "图案",
                            },
                            icon: "img/pattern.png",
                            desc: "Create by Adapter",
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${path}.pattern`,
                            common,
                            "channel",
                            null,
                            null,
                            null,
                        );
                        common = {
                            name: {
                                en: "Apply all custom raw",
                                de: "Alle benutzerdefinierten Rohdaten anwenden",
                                ru: "Применить все пользовательские исходные данные",
                                pt: "Aplicar todas as matérias-primas personalizadas",
                                nl: "Pas alle aangepaste ruwe gegevens toe.",
                                fr: "Appliquer toutes les matières brutes personnalisées",
                                it: "Applica tutte le impostazioni grezze personalizzate",
                                es: "Aplicar todo el crudo personalizado",
                                pl: "Zastosuj wszystkie niestandardowe surowe",
                                uk: "Застосувати всі користувацькі RAW-файли",
                                "zh-cn": "应用所有自定义原始数据",
                            },
                            desc: "Create by Adapter",
                            type: "string",
                            role: "json",
                            write: true,
                            read: true,
                            def: JSON.stringify({}),
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${path}.zones.setAllCustomRaw`,
                            common,
                            "state",
                            null,
                            null,
                            null,
                        );
                        common = {
                            name: {
                                en: "Update live map",
                                de: "Live-Karte aktualisieren",
                                ru: "Обновить карту в реальном времени",
                                pt: "Atualizar mapa ao vivo",
                                nl: "Live kaart bijwerken",
                                fr: "Mise à jour de la carte en direct",
                                it: "Aggiorna la mappa in tempo reale",
                                es: "Actualizar mapa en directo",
                                pl: "Aktualizuj mapę na żywo",
                                uk: "Оновити карту в реальному часі",
                                "zh-cn": "实时地图更新",
                            },
                            desc: "Create by Adapter",
                            type: "boolean",
                            role: "switch",
                            read: true,
                            write: true,
                            def: false,
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${sn}.map.livemap_update`,
                            common,
                            "state",
                            null,
                            null,
                            null,
                        );
                    }
                    const data = await this.getStateAsync(`${sn}.map.livemap_update`);
                    if (data && typeof data.val === "boolean") {
                        this.sunseeker.setLiveMap(sn, data.val);
                    }
                }
                if (!this.createObjectDone["ensureRemoteButtons"]) {
                    this.createObjectDone["ensureRemoteButtons"] = true;
                    await this.sunseeker.ensureRemoteButtons(sn);
                }
            }
            path = `${sn}.mower_raw`;
            const cleanup = this.removeNull(d);
            const states = this.statesForDevice(sn);
            if (cleanup.multi_zigzag_angles) {
                delete cleanup.multi_zigzag_angles;
            }
            if (cleanup.plan_angle) {
                delete cleanup.plan_angle;
            }
            if (cleanup.area_info) {
                delete cleanup.area_info;
            }
            await this.json2iob.parse(path, cleanup, {
                channelName: {
                    en: "All data from cloud and mqtt",
                    de: "Alle Daten aus der Cloud und MQTT",
                    ru: "Все данные поступают из облака и MQTT.",
                    pt: "Todos os dados da nuvem e do MQTT",
                    nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                    fr: "Toutes les données proviennent du cloud et de MQTT.",
                    it: "Tutti i dati dal cloud e MQTT",
                    es: "Todos los datos provienen de la nube y MQTT.",
                    pl: "Wszystkie dane z chmury i MQTT",
                    uk: "Всі дані з хмари та mqtt",
                    "zh-cn": "所有数据均来自云端和 MQTT",
                },
                forceIndex: true,
                roles: objectName.MOWER_RAW_MQTT_ROLES,
                units: objectName.MOWER_RAW_MQTT_UNITS,
                descriptions: objectName.MOWER_RAW_MQTT,
                states,
            });
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "All data from cloud and mqtt",
                        de: "Alle Daten aus der Cloud und MQTT",
                        ru: "Все данные поступают из облака и MQTT.",
                        pt: "Todos os dados da nuvem e do MQTT",
                        nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                        fr: "Toutes les données proviennent du cloud et de MQTT.",
                        it: "Tutti i dati dal cloud e MQTT",
                        es: "Todos los datos provienen de la nube y MQTT.",
                        pl: "Wszystkie dane z chmury i MQTT",
                        uk: "Всі дані з хмари та mqtt",
                        "zh-cn": "所有数据均来自云端和 MQTT",
                    },
                    icon: "img/raw.png",
                    desc: "Create by Adapter",
                };
                await this.sunseeker.createDataPoint(
                    `${this.namespace}.${sn}.mower_raw`,
                    common,
                    "channel",
                    null,
                    null,
                    null,
                );
            }
        }
    }

    /**
     * @param {string} sn
     */
    async onSunseekerRecords(sn) {
        let common;
        let path = `${sn}.events`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Event log",
                    de: "Ereignisprotokoll",
                    ru: "Журнал событий",
                    pt: "Registro de eventos",
                    nl: "Gebeurtenislogboek",
                    fr: "Journal des événements",
                    it: "Registro eventi",
                    es: "Registro de eventos",
                    pl: "Dziennik zdarzeń",
                    uk: "Журнал подій",
                    "zh-cn": "事件日志",
                },
                icon: "img/work.png",
                desc: "Create by Adapter",
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "channel", null, null, null);
        }
        path = `${sn}.events.systemMessage`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "System messages as JSON",
                    de: "Systemmeldungen als JSON",
                    ru: "Системные сообщения в формате JSON",
                    pt: "Mensagens do sistema em formato JSON",
                    nl: "Systeemberichten als JSON",
                    fr: "Messages système au format JSON",
                    it: "Messaggi di sistema in formato JSON",
                    es: "Mensajes del sistema como JSON",
                    pl: "Wiadomości systemowe w formacie JSON",
                    uk: "Системні повідомлення у форматі JSON",
                    "zh-cn": "系统消息（JSON 格式）",
                },
                desc: "Create by Adapter",
                type: "string",
                role: "json",
                write: false,
                read: true,
                def: JSON.stringify({}),
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        path = `${sn}.events.unreadSystemMessage`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Unread system messages",
                    de: "Ungelesene Systemnachrichten",
                    ru: "Непрочитанные системные сообщения",
                    pt: "Mensagens de sistema não lidas",
                    nl: "Ongelezen systeemberichten",
                    fr: "Messages système non lus",
                    it: "Messaggi di sistema non letti",
                    es: "Mensajes del sistema no leídos",
                    pl: "Nieprzeczytane wiadomości systemowe",
                    uk: "Непрочитані системні повідомлення",
                    "zh-cn": "未读系统消息",
                },
                desc: "Create by Adapter",
                type: "number",
                role: "value",
                write: false,
                read: true,
                def: 0,
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        path = `${sn}.events.unreadEventMessage`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Unread messages",
                    de: "Ungelesene Nachrichten",
                    ru: "Непрочитанные сообщения",
                    pt: "Mensagens não lidas",
                    nl: "Ongelezen berichten",
                    fr: "Messages non lus",
                    it: "Messaggi non letti",
                    es: "Mensajes no leídos",
                    pl: "Nieprzeczytane wiadomości",
                    uk: "Непрочитані повідомлення",
                    "zh-cn": "未读消息",
                },
                desc: "Create by Adapter",
                type: "number",
                role: "value",
                write: false,
                read: true,
                def: 0,
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        path = `${sn}.events.makeAllRead`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Mark all as read",
                    de: "Alle als gelesen markieren",
                    ru: "Отметьте все как прочитанное",
                    pt: "Marcar tudo como lido",
                    nl: "Markeer alles als gelezen",
                    fr: "Marquer tout comme lu",
                    it: "Segna tutto come letto",
                    es: "Marcar todo como leído",
                    pl: "Oznacz wszystkie jako przeczytane",
                    uk: "Позначити всі як прочитані",
                    "zh-cn": "全部标记为已读",
                },
                desc: "Create by Adapter",
                type: "boolean",
                role: "button",
                write: true,
                read: false,
                def: false,
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        path = `${sn}.events.eventUpdate`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Manuel update",
                    de: "Manuelle Aktualisierung",
                    ru: "Обновление руководства",
                    pt: "Atualização do Manuel",
                    nl: "Handmatige update",
                    fr: "Mise à jour du manuel",
                    it: "Aggiornamento manuale",
                    es: "Actualización de manual",
                    pl: "Aktualizacja instrukcji",
                    uk: "Оновлення Мануеля",
                    "zh-cn": "手动更新",
                },
                desc: "Create by Adapter",
                type: "boolean",
                role: "button",
                write: true,
                read: false,
                def: false,
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        path = `${sn}.events.events`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Device Messages as JSON",
                    de: "Gerätemeldungen als JSON",
                    ru: "Сообщения устройства в формате JSON",
                    pt: "Device Messages como JSON",
                    nl: "Apparaatberichten als JSON",
                    fr: "Messages de l'appareil au format JSON",
                    it: "Messaggi in JSON",
                    es: "Device Messages as JSON",
                    pl: "Wiadomości urządzenia jako JSON",
                    uk: "Повідомлення пристрою як JSON",
                    "zh-cn": "以 JSON 格式发送设备消息",
                },
                desc: "Create by Adapter",
                type: "string",
                role: "json",
                write: false,
                read: true,
                def: JSON.stringify({}),
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        path = `${sn}.events.eventNotification`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: "Event Notification",
                    de: "Ereignisbenachrichtigung",
                    ru: "Уведомление о событии",
                    pt: "Notificação de evento",
                    nl: "Gebeurtenismelding",
                    fr: "Notification d'événement",
                    it: "Notifica dell'evento",
                    es: "Notificación de evento",
                    pl: "Powiadomienie o zdarzeniu",
                    uk: "Сповіщення про подію",
                    "zh-cn": "事件通知",
                },
                desc: "Create by Adapter",
                type: "string",
                role: "json",
                write: false,
                read: true,
                def: JSON.stringify({}),
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
    }

    /**
     * @param {string} path
     */
    onSunseekerClearJson2iobCache(path) {
        this.json2iob.resetCache(path);
    }

    async onSunseekerNotice({ sn, notice }) {
        const cleanup = this.removeNull(notice);
        this.log.debug(`onSunseekerNotice: ${JSON.stringify(cleanup)}`);
        if (cleanup && this.sunseeker) {
            this.notice[sn] = cleanup;
            const path = `${sn}.notice`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                const common = {
                    name: {
                        en: "Notice Settings",
                        de: "Benachrichtigungseinstellungen",
                        ru: "Уведомление о настройках",
                        pt: "Configurações de aviso",
                        nl: "Meldingsinstellingen",
                        fr: "Paramètres de notification",
                        it: "Impostazioni notifiche",
                        es: "Configuración de avisos",
                        pl: "Ustawienia powiadomień",
                        uk: "Налаштування сповіщень",
                        "zh-cn": "通知设置",
                    },
                    icon: "img/notice.png",
                    desc: "Create by Adapter",
                };
                await this.sunseeker.createDataPoint(
                    `${this.namespace}.${sn}.notice`,
                    common,
                    "channel",
                    null,
                    true,
                    null,
                );
                const common_state = {
                    name: {
                        en: "Reload settings",
                        de: "Einstellungen neu laden",
                        ru: "Перезагрузить настройки",
                        pt: "Recarregar configurações",
                        nl: "Instellingen opnieuw laden",
                        fr: "Recharger les paramètres",
                        it: "Ricarica le impostazioni",
                        es: "Recargar configuración",
                        pl: "Załaduj ponownie ustawienia",
                        uk: "Перезавантажити налаштування",
                        "zh-cn": "重新加载设置",
                    },
                    desc: "Create by Adapter",
                    type: "boolean",
                    role: "button",
                    write: true,
                    read: false,
                    def: false,
                };
                await this.sunseeker.createDataPoint(
                    `${this.namespace}.${sn}.notice.update`,
                    common_state,
                    "state",
                    null,
                    true,
                    null,
                );
            }
            for (const message in cleanup) {
                const name = await this.sunseeker.availableMessageSettings(message);
                if (typeof name === "object") {
                    await this.setObjectNotExistsAsync(`${this.namespace}.${path}.${message}`, {
                        type: "state",
                        common: {
                            name: name,
                            desc: "Create by Adapter",
                            type: "boolean",
                            role: "switch",
                            write: true,
                            read: true,
                            def: false,
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`notice: ${error.name}: ${error.message}`);
                    });
                    await this.setState(`${this.namespace}.${path}.${message}`, { val: cleanup[message], ack: true });
                }
            }
        }
    }

    async onSunseekerCustomMultiZigZag({ sn, data }) {
        if (!this.sunseeker) {
            return;
        }
        //ToDo Add custom zigzag per zone
        this.log.debug(`onSunseekerCustomMultiZigZag: ${sn} - ${JSON.stringify(data)}`);
        const meta = this.sunseeker.deviceMeta[sn];
        this.log.debug(`Region: ${JSON.stringify(meta.custom_multi_sort)}`);
        const count_sort = Object.keys(meta.custom_multi_sort).length;
        const count_custom = typeof data.custom === "object" ? data.custom.length : 0;
        this.log.debug(`Multi: ${count_sort} - ${count_custom}`);
        if (count_custom != count_sort) {
            //Why is there a difference?
            this.log.debug(`ZigZag diff: ${count_custom} - ${count_sort}`);
            await this.delay(3000);
        }
        if (count_custom > 0) {
            this.setState(`${this.namespace}.${sn}.map.zones.setAllCustomRaw`, {
                val: JSON.stringify(data.custom),
                ack: true,
            });
            for (const custom of data.custom) {
                if (meta.custom_multi_sort[custom.region_id]) {
                    const channel = meta.custom_multi_sort[custom.region_id];
                    let path = `${sn}.map.zones.${channel}.custom`;
                    this.log.debug(`Multi-Array: ${JSON.stringify(custom)}`);
                    if (!this.createObjectDone[path]) {
                        await this.sunseeker.createCustomMultiAngle(sn, path);
                        await this.sunseeker.setCustomMultiAngle(sn, custom, path);
                        let data = {
                            multiZigzagAnglesArray: [],
                        };
                        if (custom && custom.multi_zigzag_angles) {
                            data = {
                                multiZigzagAnglesArray: custom.multi_zigzag_angles,
                            };
                        }
                        await this.onSunseekerMultiZigZag({ sn, data, path_multi: `map.zones.${channel}.custom` });
                    }
                } else {
                    this.log.warn(`Cannot found id ${custom.region_id} - ${JSON.stringify(custom)}`);
                }
            }
        }
    }

    async onSunseekerMultiZigZag({ sn, data, path_multi }) {
        let path = `${sn}.${path_multi}.multi_angle`;
        let common;
        const states = {};
        states[`00`] = "No select";
        if (!this.createObjectDone[path] && this.sunseeker) {
            common = {
                name: {
                    en: "Multi-angle",
                    de: "Multi-Winkel",
                    ru: "Многоугольный",
                    pt: "Multiângulo",
                    nl: "Meerdere hoeken",
                    fr: "Multi-angle",
                    it: "Multiangolo",
                    es: "Ángulo múltiple",
                    pl: "Wielokątowy",
                    uk: "Багатокутний",
                    "zh-cn": "多角度",
                },
                desc: "Create by Adapter",
            };
            await this.sunseeker.createDataPoint(
                `${this.namespace}.${sn}.${path_multi}.multi_angle`,
                common,
                "channel",
                null,
                null,
                null,
            );
        }
        let angle = 0;
        let angle_array = {};
        if (data && data.plan_angle && data.plan_angle.multi_zigzag_angles) {
            angle = Object.keys(data.plan_angle.multi_zigzag_angles).length;
            angle_array = data.plan_angle.multi_zigzag_angles;
        } else if (data && data.multiZigzagAnglesArray) {
            angle = Object.keys(data.multiZigzagAnglesArray).length;
            angle_array = data.multiZigzagAnglesArray;
        }
        const angle_obj = await this.loadChannels(sn, `${path_multi}.multi_angle.0`, true);
        const angles = Object.keys(angle_obj).length;
        this.log.debug(`Count angle: ${JSON.stringify(data)} - ${angle}`);
        this.log.debug(`Count angle: ${angles} - ${angle}`);
        for (let a = 1; a <= angle; a++) {
            const path = `${sn}.${path_multi}.multi_angle.0${a}`;
            states[`0${a}`] = `Multi-Angle 0${a}`;
            await this.setObjectNotExistsAsync(`${this.namespace}.${path}`, {
                type: "channel",
                common: {
                    name: {
                        en: `Zigzag ${a}`,
                        de: `Zickzack ${a}`,
                        ru: `Зигзаг ${a}`,
                        pt: `Ziguezague ${a}`,
                        nl: `Zigzag ${a}`,
                        fr: `Zigzag ${a}`,
                        it: `Zigzag ${a}`,
                        es: `Zigzag ${a}`,
                        pl: `Zygzak ${a}`,
                        uk: `Зигзаг ${a}`,
                        "zh-cn": `之字形 ${a}`,
                    },
                    desc: "Create by Adapter",
                },
                native: {},
            }).catch(error => {
                this.log.error(`zigzag: ${error.name}: ${error.message}`);
            });
            await this.setObjectNotExistsAsync(`${this.namespace}.${path}.angle`, {
                type: "state",
                common: {
                    name: {
                        en: "Multi-Angle",
                        de: "Multi-Angle",
                        ru: "Многоугольный",
                        pt: "Multiângulo",
                        nl: "Multi-hoek",
                        fr: "Multi-angle",
                        it: "Multi-angolo",
                        es: "Ángulo múltiple",
                        pl: "Multi-Angle",
                        uk: "Багатокутний",
                        "zh-cn": "多角度",
                    },
                    desc: "Create by Adapter",
                    type: "number",
                    role: "level",
                    write: true,
                    read: true,
                    unit: "°",
                    min: 0,
                    max: 180,
                    def: 90,
                },
                native: {},
            }).catch(error => {
                this.log.error(`multi-angle: ${error.name}: ${error.message}`);
            });
            await this.setObjectNotExistsAsync(`${this.namespace}.${path}.active`, {
                type: "state",
                common: {
                    name: {
                        en: "Active",
                        de: "Aktiv",
                        ru: "Активный",
                        pt: "Ativo",
                        nl: "Actief",
                        fr: "Actif",
                        it: "Attivo",
                        es: "Activo",
                        pl: "Aktywny",
                        uk: "Активний",
                        "zh-cn": "积极的",
                    },
                    desc: "Create by Adapter",
                    type: "boolean",
                    role: "switch",
                    write: true,
                    read: true,
                    def: true,
                },
                native: {},
            }).catch(error => {
                this.log.error(`multi-angle: ${error.name}: ${error.message}`);
            });
            await this.setState(`${path}.active`, {
                val: angle_array[a - 1].active,
                ack: true,
            });
            await this.setState(`${path}.angle`, { val: angle_array[a - 1].angle, ack: true });
        }
        path = `${sn}.${path_multi}.multi_angle`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            if (angles < 4) {
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}.angle`, {
                    type: "state",
                    common: {
                        name: {
                            en: "New Multi-Angle",
                            de: "Neuer Multi-Winkel",
                            ru: "Новый многоугольный объектив",
                            pt: "Novo Multiângulo",
                            nl: "Nieuwe multi-hoek",
                            fr: "Nouveau multi-angle",
                            it: "Nuovo Multi-angolo",
                            es: "Nuevo ángulo múltiple",
                            pl: "Nowy wielokątny",
                            uk: "Новий багатокутний",
                            "zh-cn": "全新多角度",
                        },
                        desc: "Create by Adapter",
                        type: "number",
                        role: "level",
                        write: true,
                        read: true,
                        unit: "°",
                        min: 0,
                        max: 180,
                        def: 90,
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`multi-angle: ${error.name}: ${error.message}`);
                });
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}.angle_active`, {
                    type: "state",
                    common: {
                        name: {
                            en: "New Multi-Angle (enable/disable)",
                            de: "Neuer Multi-Winkel (aktivieren/deaktivieren)",
                            ru: "Новая функция многоугольной съемки (включить/выключить)",
                            pt: "Novo Multi-Ângulo (ativar/desativar)",
                            nl: "Nieuwe multi-hoekmodus (inschakelen/uitschakelen)",
                            fr: "Nouvelle fonction multi-angles (activer/désactiver)",
                            it: "Nuova modalità multi-angolo (attiva/disattiva)",
                            es: "Nueva función multiángulo (activar/desactivar)",
                            pl: "Nowy Multi-Angle (włącz/wyłącz)",
                            uk: "Новий багатокутний огляд (увімкнути/вимкнути)",
                            "zh-cn": "新增多角度（启用/禁用）",
                        },
                        desc: "Create by Adapter",
                        type: "boolean",
                        role: "switch",
                        write: true,
                        read: true,
                        def: true,
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`multi-angle: ${error.name}: ${error.message}`);
                });
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}.angle_create`, {
                    type: "state",
                    common: {
                        name: {
                            en: "Create new multi-angle",
                            de: "Neue Mehrwinkel-Optionen erstellen",
                            ru: "Создайте новый многоракурсный режим",
                            pt: "Criar novo ângulo múltiplo",
                            nl: "Maak een nieuwe multi-angle",
                            fr: "Créer un nouvel angle multiple",
                            it: "Crea nuova multi-angolo",
                            es: "Crear nuevo ángulo múltiple",
                            pl: "Utwórz nowy kąt wielokątny",
                            uk: "Створити новий багатокутний",
                            "zh-cn": "创建新的多角度",
                        },
                        desc: "Create by Adapter",
                        type: "boolean",
                        role: "button",
                        write: true,
                        read: false,
                        def: false,
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`multi-angle: ${error.name}: ${error.message}`);
                });
            } else {
                await this.delObjectAsync(`${this.namespace}.${path}.angle_active`, {
                    recursive: true,
                });
                await this.delObjectAsync(`${this.namespace}.${path}.angle`, {
                    recursive: true,
                });
                await this.delObjectAsync(`${this.namespace}.${path}.angle_create`, {
                    recursive: true,
                });
                if (this.createObjectDone[path]) {
                    delete this.createObjectDone[path];
                }
            }
        }
        if (angles > 0) {
            await this.setObjectNotExistsAsync(`${this.namespace}.${path}.delete_angle`, {
                type: "state",
                common: {
                    name: {
                        en: "Delete multi-angle",
                        de: "Mehrfachwinkel löschen",
                        ru: "Удалить многоракурсный",
                        pt: "Excluir ângulos múltiplos",
                        nl: "Meerdere hoeken verwijderen",
                        fr: "Supprimer multi-angle",
                        it: "Elimina multi-angolo",
                        es: "Eliminar ángulos múltiples",
                        pl: "Usuń wielokąt",
                        uk: "Видалити багатокутний",
                        "zh-cn": "删除多角度",
                    },
                    desc: "Create by Adapter",
                    type: "string",
                    role: "state",
                    write: true,
                    read: true,
                    def: "00",
                    states: {
                        ...states,
                    },
                },
                native: {},
            }).catch(error => {
                this.log.error(`multi-angle: ${error.name}: ${error.message}`);
            });
            if (angles != angle) {
                await this.extendObject(`${path}.delete_angle`, {
                    common: {
                        states: {
                            ...states,
                        },
                    },
                });
            }
        } else {
            await this.delObjectAsync(`${this.namespace}.${path}.delete_angle`, {
                recursive: true,
            });
        }
        if (angles > angle) {
            let count = angles;
            let save = 0;
            for (let a = angle; a <= angles - 1; a++) {
                this.log.debug(`delete multi-angle: ${this.namespace}.${sn}.${path_multi}.multi_angle.0${count}`);
                await this.delObjectAsync(`${this.namespace}.${sn}.${path_multi}.multi_angle.0${count}`, {
                    recursive: true,
                });
                if (this.createObjectDone[`${sn}.${path_multi}.multi_angle.0${count}`]) {
                    delete this.createObjectDone[`${sn}.${path_multi}.multi_angle.0${count}`];
                }
                --count;
                ++save;
                if (save > 10) {
                    break;
                }
            }
        }
    }

    async onSunseekerStatus({ sn, status, settings }) {
        const states = this.statesForDevice(sn);
        if (status) {
            const cleanup = this.removeNull(status);
            await this.setSettings(sn, cleanup);
            if (cleanup.multi_zigzag_angles) {
                delete cleanup.multi_zigzag_angles;
            }
            if (cleanup.plan_angle) {
                delete cleanup.plan_angle;
            }
            if (cleanup.area_info) {
                delete cleanup.area_info;
            }
            await this.json2iob.parse(`${sn}.mower_raw`, cleanup, {
                channelName: {
                    en: "All data from cloud and mqtt",
                    de: "Alle Daten aus der Cloud und MQTT",
                    ru: "Все данные поступают из облака и MQTT.",
                    pt: "Todos os dados da nuvem e do MQTT",
                    nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                    fr: "Toutes les données proviennent du cloud et de MQTT.",
                    it: "Tutti i dati dal cloud e MQTT",
                    es: "Todos los datos provienen de la nube y MQTT.",
                    pl: "Wszystkie dane z chmury i MQTT",
                    uk: "Всі дані з хмари та mqtt",
                    "zh-cn": "所有数据均来自云端和 MQTT",
                },
                forceIndex: true,
                roles: objectName.MOWER_RAW_MQTT_ROLES,
                units: objectName.MOWER_RAW_MQTT_UNITS,
                descriptions: objectName.MOWER_RAW_MQTT,
                states,
            });
        }
        if (settings) {
            const normalized = this.normalizeSettings(settings);
            const cleanup = this.removeNull(normalized);
            await this.json2iob.parse(`${sn}.mower_raw`, cleanup, {
                channelName: {
                    en: "All data from cloud and mqtt",
                    de: "Alle Daten aus der Cloud und MQTT",
                    ru: "Все данные поступают из облака и MQTT.",
                    pt: "Todos os dados da nuvem e do MQTT",
                    nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                    fr: "Toutes les données proviennent du cloud et de MQTT.",
                    it: "Tutti i dati dal cloud e MQTT",
                    es: "Todos los datos provienen de la nube y MQTT.",
                    pl: "Wszystkie dane z chmury i MQTT",
                    uk: "Всі дані з хмари та mqtt",
                    "zh-cn": "所有数据均来自云端和 MQTT",
                },
                forceIndex: true,
                roles: objectName.MOWER_RAW_MQTT_ROLES,
                units: objectName.MOWER_RAW_MQTT_UNITS,
                descriptions: objectName.MOWER_RAW_MQTT,
                states,
            });
            const path = `${sn}.settings.pin_old`;
            let common;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "Settings",
                        de: "Einstellungen",
                        ru: "Настройки",
                        pt: "Configurações",
                        nl: "Instellingen",
                        fr: "Paramètres",
                        it: "Impostazioni",
                        es: "Ajustes",
                        pl: "Ustawienia",
                        uk: "Налаштування",
                        "zh-cn": "设置",
                    },
                    icon: "img/properties.png",
                    desc: "Create by Adapter",
                };
                await this.sunseeker.createDataPoint(
                    `${this.namespace}.${sn}.settings`,
                    common,
                    "channel",
                    null,
                    null,
                    null,
                );
                common = {
                    name: {
                        en: "Old pin code",
                        de: "Alter PIN-Code",
                        ru: "Старый пин-код",
                        pt: "Código PIN antigo",
                        nl: "Oude pincode",
                        fr: "Ancien code postal",
                        it: "Vecchio codice PIN",
                        es: "Código PIN antiguo",
                        pl: "Stary kod PIN",
                        uk: "Старий поштовий індекс",
                        "zh-cn": "旧邮政编码",
                    },
                    desc: "Create by Adapter",
                    type: "string",
                    role: "state",
                    write: true,
                    read: true,
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
                common = {
                    name: {
                        en: "New pin code/Set the old PIN first",
                        de: "Neuer PIN-Code / Zuerst den alten PIN-Code festlegen",
                        ru: "Новый PIN-код/Сначала установите старый PIN-код",
                        pt: "Novo código PIN/Primeiro, defina o PIN antigo.",
                        nl: "Nieuwe pincode/Stel eerst de oude pincode in",
                        fr: "Nouveau code PIN / Définir l'ancien code PIN en premier",
                        it: "Nuovo codice PIN/Imposta prima il vecchio PIN",
                        es: "Nuevo código PIN/Establezca primero el PIN anterior",
                        pl: "Nowy kod PIN/Najpierw ustaw stary kod PIN",
                        uk: "Новий PIN-код/Спочатку встановіть старий PIN-код",
                        "zh-cn": "新密码/先设置旧密码",
                    },
                    desc: "Create by Adapter",
                    type: "string",
                    role: "state",
                    write: true,
                    read: true,
                };
                await this.sunseeker.createDataPoint(
                    `${this.namespace}.${sn}.settings.pin_new`,
                    common,
                    "state",
                    null,
                    null,
                    null,
                );
            }
            if (this.sunseeker) {
                this.sunseeker.addTopUp(sn, this.createObjectDone);
            }
            await this.ensureWritableSettings(sn, normalized);
            await this.setSettings(sn, cleanup);
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

    onSunseekerMqtt({ sn, data, id }) {
        if (!data) {
            return;
        }
        if (id == "device_pos") {
            this.setMowerRawPos(sn, data);
            return;
        }
        if (id == "setCustomizeArea") {
            //ToDo If a pattern is created without a response, the pattern is not displayed but is still traced!!!
            if (this.patternTimeout[sn]) {
                this.clearTimeout(this.patternTimeout[sn]);
                this.patternTimeout[sn] = null;
            }
            return;
        }
        if (data.custom) {
            this.onSunseekerCustomMultiZigZag({ sn, data });
            return;
        }
        if (data.support_custom_pattern_size) {
            delete data.support_custom_pattern_size;
        }
        if (data.time && typeof data.time === "object" && data.time !== null) {
            const time_schedule = Object.assign({}, data);
            this.cleanUpCalendar(sn, time_schedule, 1);
            delete data.time;
        }
        if (data.time_custom && typeof data.time_custom === "object" && data.time_custom !== null) {
            if (data.time_custom.time && typeof data.time_custom.time === "object" && data.time_custom.time !== null) {
                const time_schedule2 = Object.assign({}, data);
                this.cleanUpCalendar(sn, time_schedule2.time_custom, 1);
                delete data.time_custom;
            } else {
                const time_schedule_custom = Object.assign({}, data);
                this.cleanUpCalendar(sn, time_schedule_custom, 2);
                delete data.time_custom;
            }
        }
        if (data.file && typeof data.event_code === "number") {
            const data_file = {};
            data_file[`file_${data.event_code}`] = data;
            if (data.event_code == 7 && this.sunseeker) {
                this.sunseeker
                    .fetchMap(sn)
                    .catch((/** @type {{ message: any; }} */ err) => this.log.debug(`Mqtt Map ${sn}: ${err.message}`));
            }
            this.setMowerRaw(sn, data_file);
            return;
        }
        if (id == "setDivideArea") {
            const data_area = {
                area_info: {
                    vertexs: JSON.stringify(data.area_info),
                },
            };
            this.setMowerRaw(sn, data_area);
            return;
        }
        if (data.area_info) {
            data.area_info = JSON.stringify(data.area_info);
        }
        if (data.custom_area_info) {
            data.custom_area_info = JSON.stringify(data.custom_area_info);
        }
        if (data.select_regions_id) {
            data.select_regions_id = JSON.stringify(data.select_regions_id);
        }
        if (data.select_region_id) {
            data.select_region_id = JSON.stringify(data.select_region_id);
        }
        if (id == "relo_status") {
            data["relo_status"] = data.status;
            delete data.status;
            this.setMowerRaw(sn, data);
            return;
        }
        if (data.rain_countdown != null) {
            if (!data.rain) {
                data.rain = {};
            }
            data.rain["rain_countdown"] = data.rain_countdown;
            delete data.rain_countdown;
        }
        if (data.rain_status != null) {
            if (!data.rain) {
                data.rain = {};
            }
            data.rain["rain_status"] = data.rain_status;
            delete data.rain_status;
        }
        if (id == "report_notice") {
            const notice = {
                notice: data,
            };
            this.setMowerRaw(sn, notice);
            return;
        }
        const cleanup = this.removeNull(data);
        this.setMowerRaw(sn, cleanup);
        //ToDo Add custom zigzag
        if (
            ((cleanup.plan_angle && cleanup.plan_angle.multi_zigzag_angles != null) ||
                cleanup.multi_zigzag_angles != null) &&
            this.sunseeker
        ) {
            const angle = {
                plan_angle: cleanup.multi_zigzag_angles != null ? cleanup.multi_zigzag_angles : cleanup.plan_angle,
            };
            this.onSunseekerMultiZigZag({ sn: sn, data: angle, path_multi: "settings" });
        }
        if (!this.firstStart[sn]) {
            this.log.debug(`ID: ${id}`);
            if (id === "getDevAllProperty") {
                this.firstStart[sn] = true;
                this.addWriteable(sn, data);
            } else {
                this.setSettings(sn, data);
            }
        } else {
            this.setSettings(sn, data);
        }
        if (id === "getDevAllProperty") {
            if (this.sunseeker) {
                this.sunseeker.setScheduleInfo(sn, data);
            }
        }
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    setMowerRawPos(sn, data) {
        this.json2iob.parse(`${sn}.mower_raw`, data, {
            channelName: {
                en: "All data from cloud and mqtt",
                de: "Alle Daten aus der Cloud und MQTT",
                ru: "Все данные поступают из облака и MQTT.",
                pt: "Todos os dados da nuvem e do MQTT",
                nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                fr: "Toutes les données proviennent du cloud et de MQTT.",
                it: "Tutti i dati dal cloud e MQTT",
                es: "Todos los datos provienen de la nube y MQTT.",
                pl: "Wszystkie dane z chmury i MQTT",
                uk: "Всі дані з хмари та mqtt",
                "zh-cn": "所有数据均来自云端和 MQTT",
            },
            forceIndex: true,
        });
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    setMowerRaw(sn, data) {
        this.json2iob.parse(`${sn}.mower_raw`, data, {
            channelName: {
                en: "All data from cloud and mqtt",
                de: "Alle Daten aus der Cloud und MQTT",
                ru: "Все данные поступают из облака и MQTT.",
                pt: "Todos os dados da nuvem e do MQTT",
                nl: "Alle gegevens zijn afkomstig uit de cloud en via MQTT.",
                fr: "Toutes les données proviennent du cloud et de MQTT.",
                it: "Tutti i dati dal cloud e MQTT",
                es: "Todos los datos provienen de la nube y MQTT.",
                pl: "Wszystkie dane z chmury i MQTT",
                uk: "Всі дані з хмари та mqtt",
                "zh-cn": "所有数据均来自云端和 MQTT",
            },
            forceIndex: true,
            roles: objectName.MOWER_RAW_MQTT_ROLES,
            units: objectName.MOWER_RAW_MQTT_UNITS,
            descriptions: objectName.MOWER_RAW_MQTT,
        });
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async addWriteable(sn, data) {
        this.firstStartTimeout = this.setTimeout(async () => {
            this.firstStartTimeout = null;
            if (data && this.sunseeker) {
                await this.sunseeker.createSettings(sn, data);
            }
            await this.setSettings(sn, data);
        }, 5000);
    }

    async onSunseekerMap({ sn, kind, payload }) {
        if (kind === "info") {
            const cleanup = this.removeNull(payload);
            await this.json2iob.parse(`${sn}.map.info`, cleanup, {
                channelName: {
                    en: "Map info",
                    de: "Karteninformationen",
                    ru: "Информация о карте",
                    pt: "Informações do mapa",
                    nl: "Kaartinformatie",
                    fr: "Informations cartographiques",
                    it: "Informazioni sulla mappa",
                    es: "Información del mapa",
                    pl: "Informacje o mapie",
                    uk: "Інформація про карту",
                    "zh-cn": "地图信息",
                },
                forceIndex: true,
                roles: {
                    mapPathFileUrl: "text.url",
                    realPathFileUlr: "text.url",
                },
            });
            return;
        }
        let common;
        let path = "";
        if (kind === "backup") {
            path = `${sn}.map.backup`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "Backup Map (JSON)",
                        de: "Backup-Karte (JSON)",
                        ru: "Карта резервного копирования (JSON)",
                        pt: "Mapa de backup (JSON)",
                        nl: "Back-upkaart (JSON)",
                        fr: "Carte de sauvegarde (JSON)",
                        it: "Mappa di backup (JSON)",
                        es: "Mapa de respaldo (JSON)",
                        pl: "Mapa kopii zapasowej (JSON)",
                        uk: "Резервна карта (JSON)",
                        "zh-cn": "备份映射（JSON）",
                    },
                    desc: "Create by Adapter",
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
            }
            this.setState(`${sn}.map.backup`, JSON.stringify(payload), true);
            this.updateMaps(sn, payload);
            return;
        }
        if (kind === "mapData" || kind === "pathData") {
            if (kind === "mapData") {
                this.checkZone(sn, payload);
            }
            path = `${sn}.map.${kind}`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: `Maps-${kind} (JSON)`,
                        de: `Karten-${kind} (JSON)`,
                        ru: `Maps-${kind} (JSON)`,
                        pt: `Mapas-${kind} (JSON)`,
                        nl: `Maps-${kind} (JSON)`,
                        fr: `Cartes-${kind} (JSON)`,
                        it: `Mappe-${kind} (JSON)`,
                        es: `Mapas-${kind} (JSON)`,
                        pl: `Mapy-${kind} (JSON)`,
                        uk: `Карти-${kind} (JSON)`,
                        "zh-cn": `地图-${kind} (JSON)`,
                    },
                    desc: "Create by Adapter",
                    type: "string",
                    role: "json",
                    read: true,
                    write: false,
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
            }
            this.setState(`${sn}.map.${kind}`, payload, true);
            return;
        }
        // image / wifi / net / texture (data URLs)
        path = `${sn}.map.${kind}`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            common = {
                name: {
                    en: `Maps-${kind} (data URL)`,
                    de: `Maps-${kind} (Daten-URL)`,
                    ru: `Maps-${kind} (data URL)`,
                    pt: `Mapas-${kind} (URL de dados)`,
                    nl: `Maps-${kind} (data-URL)`,
                    fr: `Cartes-${kind} (URL des données)`,
                    it: `Mappe-${kind} (URL dei dati)`,
                    es: `Mapas-${kind} (URL de datos)`,
                    pl: `Mapy-${kind} (adres URL danych)`,
                    uk: `Карти-${kind} (URL-адреса даних)`,
                    "zh-cn": `地图-${kind}（数据 URL)`,
                },
                desc: "Create by Adapter",
                type: "string",
                role: "text",
                read: true,
                write: false,
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        this.setState(`${sn}.map.${kind}`, payload, true);
    }

    /**
     * @param {{ sn: any; update: any; desc: any; fw: any; }} data
     */
    async onSunseekerFirmware(data) {
        this.log.debug(JSON.stringify(data));
        await this.setState(`${data.sn}.settings.firmware_update_available`, { val: data.update, ack: true });
        await this.setState(`${data.sn}.settings.firmware_description`, { val: data.desc, ack: true });
        await this.setState(`${data.sn}.settings.firmware_available`, { val: data.fw, ack: true });
    }

    /**
     * @param {any} data
     */
    async onSunseekerOwn(data) {
        this.log.debug(`own: ${JSON.stringify(data)}`);
        await this.setState(`${data.sn}.expert.response`, { val: JSON.stringify(data.data), ack: true });
    }

    /**
     * @param {{ sn: string; mode: number; }} data
     */
    async onSunseekerScheduleMode(data) {
        await this.setState(`${data.sn}.schedule.schedule_mode`, { val: data.mode, ack: true });
    }

    /**
     * @param {any} payload
     */
    async onSunseekerMqttAuth(payload) {
        const obj = Object.assign({}, payload);
        // Never persist the plaintext MQTT password: encrypt both fields.
        if (obj.pw != null) {
            obj.pw = this.encrypt(String(obj.pw));
        }
        obj.key = this.encrypt(obj.key);
        await this.setState(`auth.mqtt_connection`, { val: JSON.stringify(obj), ack: true });
    }

    /**
     * @param {string} objectId
     * @param {boolean} [val]
     */
    async onSunseekerMqttStatus(objectId, val) {
        await this.setState(`auth.${objectId}`, { val: val, ack: true });
    }

    /**
     * @param {any} payload
     */
    async onSunseekerSession(payload) {
        const obj = Object.assign({}, payload);
        obj.access_token = this.encrypt(obj.access_token);
        obj.refresh_token = this.encrypt(obj.refresh_token);
        await this.setState(`auth.session`, { val: JSON.stringify(obj), ack: true });
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async onSunseekerSharingUser(sn, data) {
        if (typeof data === "object") {
            const id = [];
            for (const user in data) {
                const cleanup = this.removeNull(data[user]);
                if (cleanup && cleanup.deviceUser && cleanup.deviceUser.id) {
                    id.push(cleanup.deviceUser.id);
                    if (cleanup.user && cleanup.user.fbToken) {
                        cleanup.user.fbToken = this.encrypt(cleanup.user.fbToken);
                    }
                    await this.json2iob.parse(`${sn}.sharing.share_user.${cleanup.deviceUser.id}`, cleanup, {
                        channelName: cleanup.user.username,
                        forceIndex: true,
                        descriptions: {
                            [`share_user.${cleanup.deviceUser.id}.deviceUser`]: cleanup.deviceUser.remark
                                ? cleanup.deviceUser.remark
                                : cleanup.deviceUser.deviceId,
                            [`share_user.${cleanup.deviceUser.id}.user`]: cleanup.user.username,
                        },
                    });
                    let path = `${sn}.sharing.share_user.${cleanup.deviceUser.id}.alias`;
                    if (!this.createObjectDone[path] && this.sunseeker) {
                        this.createObjectDone[path] = true;
                        const common = {
                            name: {
                                en: "Alias ​​assign",
                                de: "Alias zuweisen",
                                ru: "Присвоить псевдоним",
                                pt: "Atribuir alias",
                                nl: "Alias toewijzen",
                                fr: "Alias assigné",
                                it: "Assegna alias",
                                es: "Asignar alias",
                                pl: "Przypisywanie aliasów",
                                uk: "Призначення псевдонімів",
                                "zh-cn": "别名分配",
                            },
                            desc: "Create by Adapter",
                            type: "string",
                            role: "state",
                            read: true,
                            write: true,
                            def: "",
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${path}`,
                            common,
                            "state",
                            null,
                            null,
                            null,
                        );
                    }
                    if (!cleanup.deviceUser.ownerFlag) {
                        path = `${sn}.sharing.share_user.${cleanup.deviceUser.id}.revoke`;
                        if (!this.createObjectDone[path] && this.sunseeker) {
                            this.createObjectDone[path] = true;
                            const commons = {
                                name: {
                                    en: "Revoke authorization",
                                    de: "Genehmigung widerrufen",
                                    ru: "Отозвать разрешение",
                                    pt: "Revogar autorização",
                                    nl: "Autorisatie intrekken",
                                    fr: "Révoquer l'autorisation",
                                    it: "Revoca l'autorizzazione",
                                    es: "Revocar autorización",
                                    pl: "Odwołaj autoryzację",
                                    uk: "Скасувати авторизацію",
                                    "zh-cn": "撤销授权",
                                },
                                desc: "Create by Adapter",
                                type: "boolean",
                                role: "button",
                                read: false,
                                write: true,
                                def: false,
                            };
                            await this.sunseeker.createDataPoint(
                                `${this.namespace}.${path}`,
                                commons,
                                "state",
                                null,
                                null,
                                null,
                            );
                        }
                        path = `${sn}.sharing.share_user.${cleanup.deviceUser.id}.mark_revoke`;
                        if (!this.createObjectDone[path] && this.sunseeker) {
                            this.createObjectDone[path] = true;
                            const commons = {
                                name: {
                                    en: "Mark for revocation",
                                    de: "Zur Widerrufung markieren",
                                    ru: "Отметить для аннулирования",
                                    pt: "Marcar para revogação",
                                    nl: "Markeren voor intrekking",
                                    fr: "Marque pour révocation",
                                    it: "Segnalazione per revoca",
                                    es: "Marcar para revocación",
                                    pl: "Znak do odwołania",
                                    uk: "Позначити для скасування",
                                    "zh-cn": "标记为撤销",
                                },
                                desc: "Create by Adapter",
                                type: "boolean",
                                role: "switch",
                                read: true,
                                write: true,
                                def: false,
                            };
                            await this.sunseeker.createDataPoint(
                                `${this.namespace}.${path}`,
                                commons,
                                "state",
                                null,
                                null,
                                null,
                            );
                        }
                    }
                }
            }
            const all_channels = await this.getChannelsAsync();
            const share_channels = all_channels.filter(
                m => m._id.includes("sharing.share_user") && m._id.includes(sn) && m._id.split(".").length === 6,
            );
            for (const channel of share_channels) {
                const _id = channel._id.split(".").pop();
                if (!id.includes(_id)) {
                    this.log.info(`Delete invite user ${channel._id}`);
                    await this.delObjectAsync(channel._id, {
                        recursive: true,
                    });
                }
            }
        }
    }

    async onSunseekerPreviewMap({ sn, dataUrl, region }) {
        let path = "";
        if (region === "region_channel") {
            path = `${sn}.map.passages.passage_map`;
        } else if (region === "region_forbidden") {
            path = `${sn}.map.forbidden.forbidden_map`;
        } else if (region === "region_placed_blank") {
            path = `${sn}.map.placed_blank.placed_blank_map`;
        } else if (region === "region_obstacle") {
            path = `${sn}.map.obstacles.obstacle_map`;
        } else if (region === "region_customize") {
            path = `${sn}.map.pattern.pattern_map`;
        }
        this.setState(path, dataUrl, true);
    }

    async onSunseekerLivemap({ sn, dataUrl }) {
        const path = `${sn}.map.livemap`;
        if (!this.createObjectDone[path] && this.sunseeker) {
            this.createObjectDone[path] = true;
            const common = {
                name: {
                    en: "Live Map (rendered PNG data URL)",
                    de: "Live-Karte (URL der gerenderten PNG-Daten)",
                    ru: "Карта в реальном времени (URL-адрес визуализированных данных в формате PNG)",
                    pt: "Mapa ao vivo (URL com dados PNG renderizados)",
                    nl: "Live kaart (URL van weergegeven PNG-gegevens)",
                    fr: "Carte interactive (URL des données PNG rendues)",
                    it: "Mappa interattiva (URL dei dati PNG renderizzati)",
                    es: "Mapa interactivo (URL de datos PNG renderizados)",
                    pl: "Mapa na żywo (wyrenderowany adres URL danych PNG)",
                    uk: "Жива карта (URL-адреса даних PNG-візуалізації)",
                    "zh-cn": "实时地图（渲染后的PNG数据URL）",
                },
                desc: "Create by Adapter",
                type: "string",
                role: "text",
                read: true,
                write: false,
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
        this.setState(path, dataUrl, true);
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async checkZone(sn, data) {
        if (data && typeof data === "string" && data.startsWith("{")) {
            if (!this.sunseeker) {
                this.log.error(`Cannot found class sunseeker!`);
                return;
            }
            const meta = this.sunseeker.deviceMeta[sn];
            try {
                const map_info = JSON.parse(data);
                if (map_info && map_info.region_channel) {
                    if (!Array.isArray(map_info.region_channel)) {
                        return;
                    }
                    if (map_info.region_channel.length > 0) {
                        this.regionsCounter[sn].passage = map_info.region_channel.length;
                        await this.json2iob.parse(`${sn}.map.passages`, map_info.region_channel, {
                            channelName: {
                                name: {
                                    en: "Passage areas",
                                    de: "Durchgangsbereiche",
                                    ru: "Проходы",
                                    pt: "Áreas de passagem",
                                    nl: "Doorgangsgebieden",
                                    fr: "Zones de passage",
                                    it: "aree di passaggio",
                                    es: "Zonas de paso",
                                    pl: "Obszary przejść",
                                    uk: "Прохідні зони",
                                    "zh-cn": "通道区域",
                                },
                                icon: "img/passage.png",
                                desc: "Create by Adapter",
                            },
                            forceIndex: true,
                        });
                        const lang_p = {
                            en: "Passage area delete",
                            de: "Durchgangsbereich löschen",
                            ru: "Удалить область прохода",
                            pt: "área de passagem excluir",
                            nl: "Doorgangsgebied verwijderen",
                            fr: "Supprimer la zone de passage",
                            it: "Eliminazione dell'area di passaggio",
                            es: "Eliminar área de pasaje",
                            pl: "Usunięcie obszaru przejścia",
                            uk: "Видалення області проходу",
                            "zh-cn": "通道区域删除",
                        };
                        const name_p = {
                            en: "Passage areas <nr>",
                            de: "Durchgangsbereiche <nr>",
                            ru: "Проходы <nr>",
                            pt: "Áreas de passagem <nr>",
                            nl: "Doorgangsgebieden <nr>",
                            fr: "Zones de passage <nr>",
                            it: "aree di passaggio <nr>",
                            es: "Zonas de paso <nr>",
                            pl: "Obszary przejść <nr>",
                            uk: "Прохідні зони <nr>",
                            "zh-cn": "通道区域 <nr>",
                        };
                        this.sunseeker.addDeleteObject(
                            sn,
                            map_info.region_channel,
                            "passages",
                            "passage",
                            lang_p,
                            name_p,
                            this.createObjectDone,
                        );
                    } else {
                        //ToDo delete all, create, edit
                        //{"appId":"14","cmd":"draw_passage","deviceSn":"12","id":"drawPassage","method":"action","points":[[-5.168,2.105],[-2.987,-0.076]]}
                        if (this.regionsCounter[sn].passage > 0) {
                            this.regionsCounter[sn].passage = 0;
                        }
                    }
                    const rc_path = `${sn}.map.passages`;
                    if (!this.createObjectDone[rc_path]) {
                        this.createObjectDone[rc_path] = true;
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.passages`, {
                            type: "channel",
                            common: {
                                name: {
                                    en: "Passage areas",
                                    de: "Durchgangsbereiche",
                                    ru: "Проходы",
                                    pt: "Áreas de passagem",
                                    nl: "Doorgangsgebieden",
                                    fr: "Zones de passage",
                                    it: "aree di passaggio",
                                    es: "Zonas de paso",
                                    pl: "Obszary przejść",
                                    uk: "Прохідні зони",
                                    "zh-cn": "通道区域",
                                },
                                icon: "img/passage.png",
                                desc: "Create by Adapter",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Region channel create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.passages.passage_create`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Create passage area",
                                    de: "Durchgangsbereich schaffen",
                                    ru: "Создать проходную зону",
                                    pt: "Criar área de passagem",
                                    nl: "Creëer een doorgangsgebied",
                                    fr: "Créer une zone de passage",
                                    it: "Creare un'area di passaggio",
                                    es: "Crear área de paso",
                                    pl: "Utwórz obszar przejścia",
                                    uk: "Створіть зону для проходу",
                                    "zh-cn": "创建通道区域",
                                },
                                desc: "Create by Adapter",
                                type: "boolean",
                                role: "button",
                                write: true,
                                read: false,
                                def: false,
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Region channel create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.passages.passage_map`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Map",
                                    de: "Karte",
                                    ru: "Карта",
                                    pt: "Mapa",
                                    nl: "Kaart",
                                    fr: "Carte",
                                    it: "Mappa",
                                    es: "Mapa",
                                    pl: "Mapa",
                                    uk: "Карта",
                                    "zh-cn": "地图",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "text",
                                write: false,
                                read: true,
                                def: "",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Region channel: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.passages.passage_points`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Points for the passage area",
                                    de: "Punkte für den Durchgangsbereich",
                                    ru: "Точки для прохода",
                                    pt: "Pontos para a área de passagem",
                                    nl: "Punten voor het doorgangsgebied",
                                    fr: "Points pour la zone de passage",
                                    it: "Punti per l'area di passaggio",
                                    es: "Puntos para la zona de paso",
                                    pl: "Punkty za obszar przejścia",
                                    uk: "Очки для зони проходу",
                                    "zh-cn": "通道区域的积分",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "json",
                                write: true,
                                read: true,
                                def: JSON.stringify([]),
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Region channel create: ${error.name}: ${error.message}`);
                        });
                    }
                }
                if (map_info && map_info.region_forbidden) {
                    if (!Array.isArray(map_info.region_forbidden)) {
                        return;
                    }
                    if (map_info.region_forbidden.length > 0) {
                        this.regionsCounter[sn].forbidden = map_info.region_forbidden.length;
                        await this.json2iob.parse(`${sn}.map.forbidden`, map_info.region_forbidden, {
                            channelName: {
                                name: {
                                    en: "Forbidden areas",
                                    de: "Verbotene Bereiche",
                                    ru: "Запретные зоны",
                                    pt: "Áreas proibidas",
                                    nl: "Verboden gebieden",
                                    fr: "Zones interdites",
                                    it: "Aree proibite",
                                    es: "Zonas prohibidas",
                                    pl: "Zakazane obszary",
                                    uk: "Заборонені зони",
                                    "zh-cn": "禁区",
                                },
                                icon: "img/forbidden.png",
                                desc: "Create by Adapter",
                            },
                            forceIndex: true,
                        });
                        const lang_f = {
                            en: "Forbidden area delete",
                            de: "Verbotener Bereich löschen",
                            ru: "Удалить запрещенную область",
                            pt: "Excluir área proibida",
                            nl: "Verboden gebied verwijderen",
                            fr: "Supprimer la zone interdite",
                            it: "Eliminazione dell'area proibita",
                            es: "Eliminar zona prohibida",
                            pl: "Usuwanie obszaru zabronionego",
                            uk: "Видалення забороненої зони",
                            "zh-cn": "禁区删除",
                        };
                        const name_f = {
                            en: "Forbidden areas <br>",
                            de: "Verbotene Bereiche <br>",
                            ru: "Запретные зоны <br>",
                            pt: "Áreas proibidas <br>",
                            nl: "Verboden gebieden <br>",
                            fr: "Zones interdites <br>",
                            it: "Aree proibite <br>",
                            es: "Zonas prohibidas <br>",
                            pl: "Zakazane obszary <br>",
                            uk: "Заборонені зони <br>",
                            "zh-cn": "禁区 <br>",
                        };
                        this.sunseeker.addDeleteObject(
                            sn,
                            map_info.region_forbidden,
                            "forbidden",
                            "forbidden",
                            lang_f,
                            name_f,
                            this.createObjectDone,
                        );
                    } else {
                        if (this.regionsCounter[sn].forbidden > 0) {
                            this.regionsCounter[sn].forbidden = 0;
                        }
                    }
                    //ToDo delete all, create, edit
                    //forbidden tag 2 and type normal
                    //forbidden night tag 2 and type dark
                    //forbidden wall tag 1 and type normal
                    const forb_path = `${sn}.map.forbidden`;
                    if (!this.createObjectDone[forb_path]) {
                        this.createObjectDone[forb_path] = true;
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.forbidden`, {
                            type: "channel",
                            common: {
                                name: {
                                    en: "Forbidden areas",
                                    de: "Verbotene Bereiche",
                                    ru: "Запретные зоны",
                                    pt: "Áreas proibidas",
                                    nl: "Verboden gebieden",
                                    fr: "Zones interdites",
                                    it: "Aree proibite",
                                    es: "Zonas prohibidas",
                                    pl: "Zakazane obszary",
                                    uk: "Заборонені зони",
                                    "zh-cn": "禁区",
                                },
                                icon: "img/forbidden.png",
                                desc: "Create by Adapter",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Forbidden create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.forbidden.forbidden_points`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Points for the forbidden area",
                                    de: "Punkte für den verbotenen Bereich",
                                    ru: "Баллы за запретную зону",
                                    pt: "Pontos para a área proibida",
                                    nl: "Punten voor het verboden gebied",
                                    fr: "Points pour la zone interdite",
                                    it: "Punti per l'area proibita",
                                    es: "Puntos para la zona prohibida",
                                    pl: "Punkty za obszar zabroniony",
                                    uk: "Очки за заборонену зону",
                                    "zh-cn": "禁区得分",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "json",
                                write: true,
                                read: true,
                                def: JSON.stringify([]),
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Forbidden create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.forbidden.forbidden_create`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Create forbidden area",
                                    de: "Sperrzone erstellen",
                                    ru: "Создать запретную зону",
                                    pt: "Criar área proibida",
                                    nl: "Maak een verboden gebied aan.",
                                    fr: "Créer une zone interdite",
                                    it: "Creare un'area proibita",
                                    es: "Crear zona prohibida",
                                    pl: "Utwórz obszar zabroniony",
                                    uk: "Створити заборонену зону",
                                    "zh-cn": "创建禁区",
                                },
                                desc: "Create by Adapter",
                                type: "boolean",
                                role: "button",
                                write: true,
                                read: false,
                                def: false,
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Forbidden create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.forbidden.forbidden_type`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Which type should be created?",
                                    de: "Welcher Typ soll erstellt werden?",
                                    ru: "Какой тип следует создать?",
                                    pt: "Que tipo deve ser criado?",
                                    nl: "Welk type moet worden aangemaakt?",
                                    fr: "Quel type faut-il créer ?",
                                    it: "Quale tipo dovrebbe essere creato?",
                                    es: "¿Qué tipo debería crearse?",
                                    pl: "Jaki typ powinien zostać utworzony?",
                                    uk: "Який тип слід створити?",
                                    "zh-cn": "应该创建哪种类型？",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "state",
                                write: true,
                                read: true,
                                def: "default",
                                states: {
                                    default: "Generally",
                                    dark: "Nighttime",
                                    wall: "Virtual wall",
                                },
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Forbidden create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.forbidden.forbidden_map`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Map",
                                    de: "Karte",
                                    ru: "Карта",
                                    pt: "Mapa",
                                    nl: "Kaart",
                                    fr: "Carte",
                                    it: "Mappa",
                                    es: "Mapa",
                                    pl: "Mapa",
                                    uk: "Карта",
                                    "zh-cn": "地图",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "text",
                                write: false,
                                read: true,
                                def: "",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Forbidden create: ${error.name}: ${error.message}`);
                        });
                    }
                }
                if (map_info && map_info.region_obstacle) {
                    if (!Array.isArray(map_info.region_obstacle)) {
                        return;
                    }
                    if (map_info.region_obstacle.length > 0) {
                        this.regionsCounter[sn].obstacle = map_info.region_obstacle.length;
                        await this.json2iob.parse(`${sn}.map.obstacles`, map_info.region_obstacle, {
                            channelName: {
                                name: {
                                    en: "Obstacles",
                                    de: "Hindernisse",
                                    ru: "Препятствия",
                                    pt: "Obstáculos",
                                    nl: "Obstakels",
                                    fr: "Obstacles",
                                    it: "Ostacoli",
                                    es: "Obstáculos",
                                    pl: "Przeszkody",
                                    uk: "Перешкоди",
                                    "zh-cn": "障碍",
                                },
                                icon: "img/obstacle.png",
                                desc: "Create by Adapter",
                            },
                            forceIndex: true,
                        });
                        const lang_o = {
                            en: "Obstacle area delete",
                            de: "Hindernisbereich löschen",
                            ru: "Удалить зону препятствий",
                            pt: "área de obstáculo excluída",
                            nl: "Obstakelgebied verwijderen",
                            fr: "Supprimer la zone d'obstacles",
                            it: "Eliminare l'area degli ostacoli",
                            es: "Eliminar zona de obstáculos",
                            pl: "Usuwanie obszaru przeszkód",
                            uk: "Видалення зони перешкоди",
                            "zh-cn": "障碍区域删除",
                        };
                        const name_o = {
                            en: "Obstacles <nr>",
                            de: "Hindernisse <nr>",
                            ru: "Препятствия <nr>",
                            pt: "Obstáculos <nr>",
                            nl: "Obstakels <nr>",
                            fr: "Obstacles <nr>",
                            it: "Ostacoli <nr>",
                            es: "Obstáculos <nr>",
                            pl: "Przeszkody <nr>",
                            uk: "Перешкоди <nr>",
                            "zh-cn": "障碍 <nr>",
                        };
                        this.sunseeker.addDeleteObject(
                            sn,
                            map_info.region_obstacle,
                            "obstacles",
                            "obstacle",
                            lang_o,
                            name_o,
                            this.createObjectDone,
                        );
                    } else {
                        if (this.regionsCounter[sn].obstacle > 0) {
                            this.regionsCounter[sn].obstacle = 0;
                        }
                    }
                    const ob_path = `${sn}.map.obstacles`;
                    if (!this.createObjectDone[ob_path]) {
                        this.createObjectDone[ob_path] = true;
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.obstacles`, {
                            type: "channel",
                            common: {
                                name: {
                                    en: "Obstacles",
                                    de: "Hindernisse",
                                    ru: "Препятствия",
                                    pt: "Obstáculos",
                                    nl: "Obstakels",
                                    fr: "Obstacles",
                                    it: "Ostacoli",
                                    es: "Obstáculos",
                                    pl: "Przeszkody",
                                    uk: "Перешкоди",
                                    "zh-cn": "障碍",
                                },
                                icon: "img/obstacle.png",
                                desc: "Create by Adapter",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Obstacle create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.obstacles.obstacle_create`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Create obstacle area",
                                    de: "Hindernisbereich erstellen",
                                    ru: "Создайте зону препятствий",
                                    pt: "Criar área de obstáculos",
                                    nl: "Creëer een hindernisgebied",
                                    fr: "Créer une zone d'obstacles",
                                    it: "Creare un'area di ostacolo",
                                    es: "Crear zona de obstáculos",
                                    pl: "Utwórz obszar przeszkód",
                                    uk: "Створіть зону перешкод",
                                    "zh-cn": "创建障碍区域",
                                },
                                desc: "Create by Adapter",
                                type: "boolean",
                                role: "button",
                                write: true,
                                read: false,
                                def: false,
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Obstacle create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.obstacles.obstacle_map`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Map",
                                    de: "Karte",
                                    ru: "Карта",
                                    pt: "Mapa",
                                    nl: "Kaart",
                                    fr: "Carte",
                                    it: "Mappa",
                                    es: "Mapa",
                                    pl: "Mapa",
                                    uk: "Карта",
                                    "zh-cn": "地图",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "text",
                                write: false,
                                read: true,
                                def: "",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Obstacle: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.obstacles.obstacle_points`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Points for the obstacle area",
                                    de: "Punkte für den Hindernisbereich",
                                    ru: "Баллы за зону препятствий",
                                    pt: "Pontos para a área de obstáculos",
                                    nl: "Punten voor het hindernisgebied",
                                    fr: "Points pour la zone d'obstacles",
                                    it: "Punti per l'area degli ostacoli",
                                    es: "Puntos para la zona de obstáculos",
                                    pl: "Punkty za obszar przeszkód",
                                    uk: "Очки за зону перешкод",
                                    "zh-cn": "障碍区域得分",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "json",
                                write: true,
                                read: true,
                                def: JSON.stringify([]),
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Obstacle: ${error.name}: ${error.message}`);
                        });
                    }
                }
                if (map_info && map_info.region_placed_blank) {
                    if (!Array.isArray(map_info.region_placed_blank)) {
                        return;
                    }
                    if (map_info.region_placed_blank.length > 0) {
                        this.regionsCounter[sn].placed = map_info.region_placed_blank.length;
                        await this.json2iob.parse(`${sn}.map.placed_blank`, map_info.region_placed_blank, {
                            channelName: {
                                name: {
                                    en: "Safe areas",
                                    de: "Sichere Bereiche",
                                    ru: "Безопасные зоны",
                                    pt: "Áreas seguras",
                                    nl: "Veilige gebieden",
                                    fr: "Zones sécurisées",
                                    it: "Zone sicure",
                                    es: "Zonas seguras",
                                    pl: "Bezpieczne obszary",
                                    uk: "Безпечні зони",
                                    "zh-cn": "安全区域",
                                },
                                icon: "img/placed.png",
                                desc: "Create by Adapter",
                            },
                            forceIndex: true,
                        });
                        const lang_pl = {
                            en: "Delete safe area",
                            de: "Sicheren Bereich löschen",
                            ru: "Удалить безопасную зону",
                            pt: "Excluir área segura",
                            nl: "Veilig gebied verwijderen",
                            fr: "Supprimer la zone de sécurité",
                            it: "Elimina l'area sicura",
                            es: "Eliminar zona segura",
                            pl: "Usuń obszar bezpieczny",
                            uk: "Видалити безпечну зону",
                            "zh-cn": "删除安全区域",
                        };
                        const name_pl = {
                            en: "Safe areas <nr>",
                            de: "Sichere Bereiche <nr>",
                            ru: "Безопасные зоны <nr>",
                            pt: "Áreas seguras <nr>",
                            nl: "Veilige gebieden <nr>",
                            fr: "Zones sécurisées <nr>",
                            it: "Zone sicure <nr>",
                            es: "Zonas seguras <nr>",
                            pl: "Bezpieczne obszary <nr>",
                            uk: "Безпечні зони <nr>",
                            "zh-cn": "安全区域 <nr>",
                        };
                        this.sunseeker.addDeleteObject(
                            sn,
                            map_info.region_placed_blank,
                            "placed_blank",
                            "placed_blank",
                            lang_pl,
                            name_pl,
                            this.createObjectDone,
                        );
                    } else {
                        //ToDo delete all, create, edit
                        //{"appId":"12","area_info":[{"map_id":1789068055377,"vertexs":[[-3.542,3.499],[-3.542,0.918],[-6.123,0.918],[-6.123,3.499],[-3.542,3.499]]}],"deviceSn":"12","id":"setPlacedBlankArea","key":"placed_blank_area","method":"set_property"}
                        if (this.regionsCounter[sn].placed > 0) {
                            this.regionsCounter[sn].placed = 0;
                        }
                    }
                    const pb_path = `${sn}.map.placed_blank`;
                    if (!this.createObjectDone[pb_path]) {
                        this.createObjectDone[pb_path] = true;
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.placed_blank`, {
                            type: "channel",
                            common: {
                                name: {
                                    en: "Safe areas",
                                    de: "Sichere Bereiche",
                                    ru: "Безопасные зоны",
                                    pt: "Áreas seguras",
                                    nl: "Veilige gebieden",
                                    fr: "Zones sécurisées",
                                    it: "Zone sicure",
                                    es: "Zonas seguras",
                                    pl: "Bezpieczne obszary",
                                    uk: "Безпечні зони",
                                    "zh-cn": "安全区域",
                                },
                                icon: "img/placed.png",
                                desc: "Create by Adapter",
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`Place blank create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(
                            `${this.namespace}.${sn}.map.placed_blank.placed_blank_create`,
                            {
                                type: "state",
                                common: {
                                    name: {
                                        en: "Create safe area",
                                        de: "Sicheren Bereich schaffen",
                                        ru: "Создайте безопасную зону",
                                        pt: "Criar área segura",
                                        nl: "Creëer een veilige zone",
                                        fr: "Créer une zone sécurisée",
                                        it: "Creare un'area sicura",
                                        es: "Crear zona segura",
                                        pl: "Utwórz bezpieczny obszar",
                                        uk: "Створити безпечну зону",
                                        "zh-cn": "创建安全区域",
                                    },
                                    desc: "Create by Adapter",
                                    type: "boolean",
                                    role: "button",
                                    write: true,
                                    read: false,
                                    def: false,
                                },
                                native: {},
                            },
                        ).catch(error => {
                            this.log.error(`Place blank create: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(
                            `${this.namespace}.${sn}.map.placed_blank.placed_blank_map`,
                            {
                                type: "state",
                                common: {
                                    name: {
                                        en: "Map",
                                        de: "Karte",
                                        ru: "Карта",
                                        pt: "Mapa",
                                        nl: "Kaart",
                                        fr: "Carte",
                                        it: "Mappa",
                                        es: "Mapa",
                                        pl: "Mapa",
                                        uk: "Карта",
                                        "zh-cn": "地图",
                                    },
                                    desc: "Create by Adapter",
                                    type: "string",
                                    role: "text",
                                    write: false,
                                    read: true,
                                    def: "",
                                },
                                native: {},
                            },
                        ).catch(error => {
                            this.log.error(`Place blank: ${error.name}: ${error.message}`);
                        });
                        await this.setObjectNotExistsAsync(
                            `${this.namespace}.${sn}.map.placed_blank.placed_blank_points`,
                            {
                                type: "state",
                                common: {
                                    name: {
                                        en: "Points for the safe area",
                                        de: "Punkte für den sicheren Bereich",
                                        ru: "Баллы за безопасную зону",
                                        pt: "Pontos para a área segura",
                                        nl: "Punten voor het veilige gebied",
                                        fr: "Points pour la zone sécurisée",
                                        it: "Punti per la zona sicura",
                                        es: "Puntos para la zona segura",
                                        pl: "Punkty za bezpieczną strefę",
                                        uk: "Очки для безпечної зони",
                                        "zh-cn": "安全区域的积分",
                                    },
                                    desc: "Create by Adapter",
                                    type: "string",
                                    role: "json",
                                    write: true,
                                    read: true,
                                    def: JSON.stringify([]),
                                },
                                native: {},
                            },
                        ).catch(error => {
                            this.log.error(`Place blank: ${error.name}: ${error.message}`);
                        });
                    }
                }

                if (map_info.region_blank) {
                    if (!Array.isArray(map_info.region_blank)) {
                        return;
                    }
                    if (map_info.region_blank.length > 0) {
                        this.regionsCounter[sn].blank = map_info.region_blank.length;
                        await this.json2iob.parse(`${sn}.map.blank`, map_info.region_blank, {
                            channelName: {
                                name: {
                                    en: "Boundary properties",
                                    de: "Kanteneigenschaften",
                                    ru: "Свойства ребер",
                                    pt: "Propriedades de borda",
                                    nl: "Randeigenschappen",
                                    fr: "Propriétés de bord",
                                    it: "Proprietà dei bordi",
                                    es: "Propiedades de borde",
                                    pl: "Właściwości krawędzi",
                                    uk: "Властивості ребра",
                                    "zh-cn": "边缘属性",
                                },
                                icon: "img/blank.png",
                                desc: "Create by Adapter",
                            },
                            forceIndex: true,
                        });
                        const lang_b = {
                            en: "Delete Boundary property",
                            de: "Kanteneigenschaft löschen",
                            ru: "Удалить свойство ребра",
                            pt: "Excluir propriedade de borda",
                            nl: "Randeigenschap verwijderen",
                            fr: "Supprimer la propriété de bord",
                            it: "Elimina la proprietà del bordo",
                            es: "Eliminar propiedad de borde",
                            pl: "Usuń właściwość krawędzi",
                            uk: "Видалити властивість ребра",
                            "zh-cn": "删除边属性",
                        };
                        const name_b = {
                            en: "Boundary property <br>",
                            de: "Kanteneigenschaft <br>",
                            ru: "Краевая собственность <br>",
                            pt: "Propriedade Edge <br>",
                            nl: "Randeigenschap <br>",
                            fr: "Propriété de bord <br>",
                            it: "proprietà del bordo <br>",
                            es: "Propiedad Edge <br>",
                            pl: "Właściwość krawędzi <br>",
                            uk: "Властивість краю <br>",
                            "zh-cn": "边缘属性 <br>",
                        };
                        this.sunseeker.addDeleteObject(
                            sn,
                            map_info.region_blank,
                            "blank",
                            "blank",
                            lang_b,
                            name_b,
                            this.createObjectDone,
                        );
                    } else {
                        if (this.regionsCounter[sn].blank > 0) {
                            this.regionsCounter[sn].blank = 0;
                            await this.delObjectAsync(`${this.namespace}.${sn}.map.blank`, {
                                recursive: true,
                            });
                            delete this.createObjectDone[`${sn}.map.blank`];
                        }
                    }
                }

                if (map_info && map_info.region_work) {
                    if (!Array.isArray(map_info.region_work)) {
                        return;
                    }
                    this.regionId[sn] = [];
                    meta.custom_multi_sort = {};
                    let count = 1;
                    for (const region of map_info.region_work) {
                        if (map_info.update_time) {
                            region["mapId"] = map_info.update_time;
                        } else {
                            region["mapId"] = meta.mapid;
                        }
                        if (region.id) {
                            meta.custom_multi_sort[region.id] = `0${count}`;
                        }
                        ++count;
                        this.regionId[sn].push(region.id);
                    }
                    //ToDo search active region_id
                    if (this.createObjectDone[`${sn}.schedule.zones_available`]) {
                        await this.setState(`${this.namespace}.${sn}.schedule.zones_available`, {
                            val: JSON.stringify(this.regionId[sn]),
                            ack: true,
                        });
                    }
                    await this.setState(`${sn}.remote.startZones`, {
                        val: JSON.stringify(this.regionId[sn]),
                        ack: true,
                    });
                    await this.json2iob.parse(`${sn}.map.zones`, map_info.region_work, {
                        channelName: {
                            en: "Zones",
                            de: "Zonen",
                            ru: "Зоны",
                            pt: "Zonas",
                            nl: "Zones",
                            fr: "Zones",
                            it: "Zone",
                            es: "Zonas",
                            pl: "Strefy",
                            uk: "Зони",
                            "zh-cn": "Zones",
                        },
                        forceIndex: true,
                        roles: {
                            id: "value",
                            mapId: "value",
                        },
                    });
                    const zone = Object.keys(map_info.region_work).length;
                    const zone_obj = await this.loadChannels(sn, "map.zones.0", false);
                    const zones = Object.keys(zone_obj).length;
                    for (let a = 1; a <= zone; a++) {
                        const path = `${sn}.map.zones.0${a}`;
                        if (!this.createObjectDone[path] && this.sunseeker) {
                            this.createObjectDone[path] = true;
                            await this.extendObject(`${path}.name`, { common: { write: true } });
                            if (zones < 4) {
                                await this.setObjectNotExistsAsync(
                                    `${this.namespace}.${path}.start_mowing_selected_area`,
                                    {
                                        type: "state",
                                        common: {
                                            name: {
                                                en: "Start mowing selected area",
                                                de: "Mit dem Mähen des ausgewählten Bereichs beginnen",
                                                ru: "Начать косить выбранный участок",
                                                pt: "Iniciar o corte na área selecionada",
                                                nl: "Begin met het maaien van het geselecteerde gebied",
                                                fr: "Commencer à tondre la zone sélectionnée",
                                                it: "Inizia a falciare l'area selezionata",
                                                es: "Empezar a cortar el césped en la zona seleccionada",
                                                pl: "Rozpocznij koszenie wybranego obszaru",
                                                uk: "Почати косіння вибраної ділянки",
                                                "zh-cn": "Start mowing selected area",
                                            },
                                            desc: "Create by Adapter",
                                            type: "string",
                                            role: "json",
                                            write: true,
                                            read: true,
                                            def: JSON.stringify([]),
                                        },
                                        native: {},
                                    },
                                ).catch(error => {
                                    this.log.error(`zones split: ${error.name}: ${error.message}`);
                                });
                                await this.setObjectNotExistsAsync(`${this.namespace}.${path}.split_zones`, {
                                    type: "state",
                                    common: {
                                        name: {
                                            en: "Work area split e.g. [[-1.269,-17.454], [-8.25, -18.668]]",
                                            de: "Aufteilung des Arbeitsbereichs, z. B. [[-1,269, -17,454], [-8,25, -18,668]]",
                                            ru: "Разделение рабочей области, например: [[-1,269; -17,454], [-8,25; -18,668]]",
                                            pt: "Divisão da área de trabalho, por exemplo: [[-1,269; -17,454], [-8,25; -18,668]]",
                                            nl: "Opgesplitst werkgebied, bijv. [[-1,269, -17,454], [-8,25, -18,668]]",
                                            fr: "Division de la zone de travail, par exemple [[-1,269, -17,454], [-8,25, -18,668]]",
                                            it: "Divisione dell'area di lavoro, ad esempio [[-1,269; -17,454], [-8,25; -18,668]]",
                                            es: "División del área de trabajo, p. ej., [[-1,269; -17,454], [-8,25; -18,668]]",
                                            pl: "Podział obszaru roboczego, np. [[-1,269; -17,454], [-8,25; -18,668]]",
                                            uk: "Розділення робочої області, наприклад: [[-1,269; -17,454], [-8,25; -18,668]]",
                                            "zh-cn": "Work area split e.g. [[-1.269,-17.454], [-8.25, -18.668]]",
                                        },
                                        desc: "Create by Adapter",
                                        type: "string",
                                        role: "json",
                                        write: true,
                                        read: true,
                                        def: JSON.stringify([]),
                                    },
                                    native: {},
                                }).catch(error => {
                                    this.log.error(`zones split: ${error.name}: ${error.message}`);
                                });
                            } else {
                                await this.delObjectAsync(`${this.namespace}.${path}.split_zones`, {
                                    recursive: true,
                                });
                            }
                            await this.extendObject(path, {
                                common: {
                                    name: {
                                        en: `Zone ${a}`,
                                        de: `Zone ${a}`,
                                        ru: `Зона ${a}`,
                                        pt: `Zona ${a}`,
                                        nl: `Zone ${a}`,
                                        fr: `Zone ${a}`,
                                        it: `Zona ${a}`,
                                        es: `Zona ${a}`,
                                        pl: `Strefa ${a}`,
                                        uk: `Зона ${a}`,
                                        "zh-cn": `Zone ${a}`,
                                    },
                                    desc: "Create by Adapter",
                                },
                            });
                        }
                    }
                    if (zones > 1) {
                        await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.zones.merge_zones`, {
                            type: "state",
                            common: {
                                name: {
                                    en: "Work area merge e.g. [1,2]",
                                    de: "Arbeitsbereich zusammenführen, z. B. [1,2]",
                                    ru: "Объединение рабочих областей, например [1,2]",
                                    pt: "Unir a área de trabalho, por exemplo, [1,2]",
                                    nl: "Werkgebied samenvoegen, bijv. [1,2]",
                                    fr: "Fusionner la zone de travail, par exemple [1,2]",
                                    it: "Unione dell'area di lavoro, ad esempio [1,2]",
                                    es: "Área de trabajo de fusión, p. ej., [1,2]",
                                    pl: "Połączenie obszarów roboczych, np. [1,2]",
                                    uk: "Об’єднання робочої області, наприклад [1,2]",
                                    "zh-cn": "Work area merge e.g. [1,2]",
                                },
                                desc: "Create by Adapter",
                                type: "string",
                                role: "json",
                                write: true,
                                read: true,
                                def: JSON.stringify([]),
                            },
                            native: {},
                        }).catch(error => {
                            this.log.error(`zones merge: ${error.name}: ${error.message}`);
                        });
                    } else {
                        await this.delObjectAsync(`${this.namespace}.${sn}.map.zones.merge_zones`, {
                            recursive: true,
                        });
                    }
                    if (zones > zone) {
                        let count = zones;
                        let save = 0;
                        for (let a = zone; a <= zones - 1; a++) {
                            this.log.info(`Delete zone: ${this.namespace}.${sn}.map.zones.0${count}`);
                            await this.delObjectAsync(`${this.namespace}.${sn}.map.zones.0${count}`, {
                                recursive: true,
                            });
                            this.json2iob.resetCache(`${sn}.map.zones.0${count}`);
                            if (this.createObjectDone[`${sn}.map.zones.0${count}`]) {
                                delete this.createObjectDone[`${sn}.map.zones.0${count}`];
                            }
                            --count;
                            ++save;
                            if (save > 10) {
                                break;
                            }
                        }
                    }
                }
                if (map_info && map_info.region_customize) {
                    if (!Array.isArray(map_info.region_customize)) {
                        return;
                    }
                    await this.json2iob.parse(`${sn}.map.pattern`, map_info.region_customize, {
                        channelName: {
                            en: "Pattern",
                            de: "Muster",
                            ru: "Шаблон",
                            pt: "Padrão",
                            nl: "Patroon",
                            fr: "Modèle",
                            it: "Modello",
                            es: "Patrón",
                            pl: "Wzór",
                            uk: "Візерунок",
                            "zh-cn": "图案",
                        },
                        forceIndex: true,
                        roles: {
                            id: "value",
                            area_id: "value",
                            expiration_time: "value.time",
                            last_edit_time: "value.time",
                        },
                    });
                    await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.pattern.delete_all_pattern`, {
                        type: "state",
                        common: {
                            name: {
                                en: "Clear all pattern",
                                de: "Alle Muster löschen",
                                ru: "Очистить все шаблоны",
                                pt: "Limpar todos os padrões",
                                nl: "Wis alle patronen",
                                fr: "Effacer tous les motifs",
                                it: "Cancella tutti i modelli",
                                es: "Borrar todo patrón",
                                pl: "Wyczyść wszystkie wzory",
                                uk: "Очистити всі візерунки",
                                "zh-cn": "清除所有模式",
                            },
                            desc: "Create by Adapter",
                            type: "boolean",
                            role: "button",
                            write: true,
                            read: false,
                            def: false,
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`pattern delete: ${error.name}: ${error.message}`);
                    });
                    await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.pattern.pattern_map`, {
                        type: "state",
                        common: {
                            name: {
                                en: "Map",
                                de: "Karte",
                                ru: "Карта",
                                pt: "Mapa",
                                nl: "Kaart",
                                fr: "Carte",
                                it: "Mappa",
                                es: "Mapa",
                                pl: "Mapa",
                                uk: "Карта",
                                "zh-cn": "地图",
                            },
                            desc: "Create by Adapter",
                            type: "string",
                            role: "text",
                            write: false,
                            read: true,
                            def: "",
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`Pattern Map: ${error.name}: ${error.message}`);
                    });
                    await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.pattern.delete_automatic`, {
                        type: "state",
                        common: {
                            name: {
                                en: "Automatic clear",
                                de: "Automatische Löschung",
                                ru: "Автоматическая очистка",
                                pt: "Limpeza automática",
                                nl: "Automatisch wissen",
                                fr: "Effacement automatique",
                                it: "Cancellazione automatica",
                                es: "Borrado automático",
                                pl: "Automatyczne czyszczenie",
                                uk: "Автоматичне очищення",
                                "zh-cn": "自动清除",
                            },
                            desc: "Create by Adapter",
                            type: "number",
                            role: "level",
                            write: true,
                            read: true,
                            min: 5,
                            max: 30,
                            step: 5,
                            def: 5,
                            states: {
                                5: "5 days",
                                10: "10 days",
                                15: "15 days",
                                20: "20 days",
                                25: "25 days",
                                30: "30 days",
                            },
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`pattern clean: ${error.name}: ${error.message}`);
                    });
                    await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.pattern.create_pattern`, {
                        type: "state",
                        common: {
                            name: {
                                en: "Create pattern (value points from region)",
                                de: "Muster erstellen (Wertpunkte aus der Region)",
                                ru: "Создать шаблон (значения точек из региона)",
                                pt: "Criar padrão (pontos de valor da região)",
                                nl: "Creëer een patroon (waardepunten uit de regio)",
                                fr: "Créer un motif (points de valeur de la région)",
                                it: "Crea un modello (punti valore dalla regione)",
                                es: "Crear patrón (valorar puntos de la región)",
                                pl: "Utwórz wzór (punkty wartości z regionu)",
                                uk: "Створити візерунок (оцінка балів з регіону)",
                                "zh-cn": "创建模式（来自区域的值点）",
                            },
                            desc: "Create by Adapter",
                            type: "boolean",
                            role: "button",
                            write: true,
                            read: false,
                            def: false,
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`pattern create: ${error.name}: ${error.message}`);
                    });
                    await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.pattern.points_pattern`, {
                        type: "state",
                        common: {
                            name: {
                                en: "Pattern points (value points from region)",
                                de: "Musterpunkte (Wertpunkte aus Region)",
                                ru: "Точки узора (значения точек из региона)",
                                pt: "Pontos padrão (valores da região)",
                                nl: "Patroonpunten (waardepunten uit de regio)",
                                fr: "Points de référence (valeur par région)",
                                it: "Punti modello (valore per regione)",
                                es: "Puntos patrón (puntos de valor de la región)",
                                pl: "Punkty wzoru (punkty wartości z regionu)",
                                uk: "Точки шаблону (значення балів з регіону)",
                                "zh-cn": "模式点（来自区域的价值点）",
                            },
                            desc: "Create by Adapter",
                            type: "string",
                            role: "json",
                            write: true,
                            read: true,
                            def: JSON.stringify([]),
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`pattern create: ${error.name}: ${error.message}`);
                    });
                    await this.setObjectNotExistsAsync(`${this.namespace}.${sn}.map.pattern.selecte_pattern`, {
                        type: "state",
                        common: {
                            name: {
                                en: "Select pattern",
                                de: "Muster auswählen",
                                ru: "Выберите шаблон",
                                pt: "Selecione o padrão",
                                nl: "Selecteer patroon",
                                fr: "Sélectionner le motif",
                                it: "Seleziona il modello",
                                es: "Seleccionar patrón",
                                pl: "Wybierz wzór",
                                uk: "Виберіть візерунок",
                                "zh-cn": "图案",
                            },
                            desc: "Create by Adapter",
                            type: "string",
                            role: "state",
                            write: true,
                            read: true,
                            def: "FOUR_POINT_STAR",
                            states: meta.pattern,
                        },
                        native: {},
                    }).catch(error => {
                        this.log.error(`pattern select: ${error.name}: ${error.message}`);
                    });
                    const pattern = Object.keys(map_info.region_customize).length;
                    const pattern_obj = await this.loadChannels(sn, "map.pattern.0", false);
                    const patterns = Object.keys(pattern_obj).length;
                    for (let a = 1; a <= pattern; a++) {
                        const path = `${sn}.map.pattern.0${a}`;
                        if (!this.createObjectDone[path]) {
                            this.createObjectDone[path] = true;
                            await this.setObjectNotExistsAsync(`${this.namespace}.${path}.pattern_delete`, {
                                type: "state",
                                common: {
                                    name: {
                                        en: "Pattern delete",
                                        de: "Muster löschen",
                                        ru: "Удаление шаблона",
                                        pt: "Excluir padrão",
                                        nl: "Patroon verwijderen",
                                        fr: "Suppression de motif",
                                        it: "Eliminazione modello",
                                        es: "Eliminar patrón",
                                        pl: "Usuwanie wzoru",
                                        uk: "Видалення візерунка",
                                        "zh-cn": "删除模式",
                                    },
                                    desc: "Create by Adapter",
                                    type: "boolean",
                                    role: "button",
                                    write: true,
                                    read: false,
                                    def: false,
                                },
                                native: {},
                            }).catch(error => {
                                this.log.error(`pattern del: ${error.name}: ${error.message}`);
                            });
                            await this.extendObject(path, {
                                common: {
                                    name: {
                                        en: `Pattern ${a}`,
                                        de: `Muster ${a}`,
                                        ru: `Шаблон ${a}`,
                                        pt: `Padrão ${a}`,
                                        nl: `Patroon ${a}`,
                                        fr: `Modèle ${a}`,
                                        it: `Modello ${a}`,
                                        es: `Patrón ${a}`,
                                        pl: `Wzór ${a}`,
                                        uk: `Візерунок ${a}`,
                                        "zh-cn": `图案 ${a}`,
                                    },
                                    desc: "Create by Adapter",
                                },
                            });
                            await this.extendObject(`${path}.img_value`, {
                                common: {
                                    name: {
                                        en: "Change Image",
                                        de: "Bild ändern",
                                        ru: "Изменить изображение",
                                        pt: "Alterar imagem",
                                        nl: "Afbeelding wijzigen",
                                        fr: "Changer l'image",
                                        it: "Cambia immagine",
                                        es: "Cambiar imagen",
                                        pl: "Zmień obraz",
                                        uk: "Змінити зображення",
                                        "zh-cn": "更改图像",
                                    },
                                    desc: "Create by Adapter",
                                    write: true,
                                    states: meta.pattern,
                                },
                            });
                        }
                    }
                    if (patterns > pattern) {
                        let count = patterns;
                        let save = 0;
                        for (let a = pattern; a <= patterns - 1; a++) {
                            this.log.info(
                                `Delete pattern: ${this.namespace}.${sn}.map.pattern.${`0${count}`.slice(-2)}`,
                            );
                            await this.delObjectAsync(`${this.namespace}.${sn}.map.pattern.${`0${count}`.slice(-2)}`, {
                                recursive: true,
                            });
                            this.json2iob.resetCache(`${sn}.map.pattern.${`0${count}`.slice(-2)}`);
                            if (this.createObjectDone[`${sn}.map.pattern.${`0${count}`.slice(-2)}`]) {
                                delete this.createObjectDone[`${sn}.map.pattern.${`0${count}`.slice(-2)}`];
                            }
                            --count;
                            ++save;
                            if (save > 10) {
                                break;
                            }
                        }
                    }
                }
                this.log.debug(`${sn}: Create custom-multi-angle`);
            } catch (e) {
                this.log.error(`checkZone: ${e}`);
            }
        }
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
        const raw = this.sunseeker.devicesRaw[parts[2]];
        if (!raw) {
            this.log.warn(`onStateChange: Device ${parts[2]} unknown`);
            return;
        }
        const mapIdx = parts.indexOf("map");
        if (!raw.online) {
            if (mapIdx > 0) {
                this.log.warn(`onStateChange: Device ${parts[2]} is offline`);
                return;
            }
        }
        const eventsIdx = parts.indexOf("events");
        if (eventsIdx > 0) {
            if (parts[eventsIdx + 1] === "eventUpdate") {
                this.sunseeker.getEvents(parts[eventsIdx - 1], 1, 10);
                this.setState(id, { val: false, ack: true });
                return;
            } else if (parts[eventsIdx + 1] === "makeAllRead" && state.val) {
                this.sunseeker.setMarkAllAsRead(parts[eventsIdx - 1]);
                this.setState(id, { val: false, ack: true });
                return;
            }
        }
        const theftIdx = parts.indexOf("antiTheft");
        if (theftIdx > 0) {
            if (parts[theftIdx + 1] === "fence") {
                const sn_theft = parts[theftIdx - 1];
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    this.setAntiTheft(id, sn_theft, "fence", state.val);
                }
                return;
            }
            if (parts[theftIdx + 1] === "fence_digital") {
                const sn_theft = parts[theftIdx - 1];
                if (typeof state.val === "boolean") {
                    this.setAntiTheft(id, sn_theft, "fence_digital", state.val);
                }
                return;
            }
        }
        const noticeIdx = parts.indexOf("notice");
        if (noticeIdx > 0) {
            if (parts[noticeIdx] === "notice") {
                this.log.debug(JSON.stringify(this.notice));
                const sn_notice = parts[noticeIdx - 1];
                if (sn_notice && this.notice[sn_notice]) {
                    const noticeName = parts[noticeIdx + 1];
                    if (noticeName === "update") {
                        this.sunseeker.getNotice(sn_notice);
                        this.setState(id, { val: false, ack: true });
                        return;
                    }
                    const sendJson = {};
                    if (noticeName && this.notice[sn_notice][noticeName] != null) {
                        sendJson[noticeName] = state.val;
                        this.setNotice(sn_notice, sendJson);
                        this.setState(id, { val: state.val, ack: true });
                    }
                }
                return;
            }
        }
        const setIdx = parts.indexOf("map_settings");
        if (setIdx > 0 && parts[setIdx] === "map_settings") {
            this.sunseeker.setLiveSettings(parts[setIdx - 2], state, parts[setIdx + 1]);
            this.setState(id, { val: state.val, ack: true });
            return;
        }
        const shareIdx = parts.indexOf("sharing");
        if (shareIdx > 0 && parts[shareIdx + 1]) {
            const shareSn = parts[shareIdx - 1];
            if (parts[shareIdx + 1] === "share_email" && typeof state.val === "string") {
                if (this.isValidSyntax(state.val)) {
                    this.setState(id, { val: state.val, ack: true });
                } else {
                    this.log.warn(`Wrong Email - ${state.val}`);
                }
                return;
            }
            if (parts[shareIdx + 3] === "mark_revoke" && typeof state.val === "boolean") {
                if (state.val) {
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (parts[shareIdx + 1] === "select_device" && typeof state.val === "string") {
                if (state.val != "none") {
                    this.setState(id, { val: state.val, ack: true });
                } else {
                    this.log.warn(`Wrong userId - ${state.val}`);
                }
                return;
            }
            this.shareCommand(id, shareSn, state);
            return;
        }
        const patternIdx = parts.indexOf("pattern");
        if (patternIdx > 0 && parts[patternIdx + 1]) {
            const patternSn = parts[patternIdx - 2];
            if (parts[patternIdx + 1] === "points_pattern" && typeof state.val === "string") {
                this.createPreviewMap(id, "region_customize", state.val, patternSn);
                return;
            }
            this.patternHandler(id, patternSn, state);
            return;
        }
        const passageIdx = parts.indexOf("passages");
        if (passageIdx > 0) {
            const passageSn = parts[passageIdx - 2];
            if (parts[passageIdx + 2] === "delete_passage") {
                this.deleteRegion(id, passageSn, "region_channel", "passages");
                return;
            }
            if (parts[passageIdx + 1] === "passage_create" && typeof state.val === "string") {
                this.createRegion(id, passageSn, "region_channel", "passages");
                return;
            }
            if (parts[passageIdx + 1] === "passage_points" && typeof state.val === "string") {
                this.createPreviewMap(id, "region_channel", state.val, passageSn);
                return;
            }
        }
        const forbiddenIdx = parts.indexOf("forbidden");
        if (forbiddenIdx > 0) {
            const forbiddenSn = parts[forbiddenIdx - 2];
            if (parts[forbiddenIdx + 2] === "delete_forbidden") {
                this.deleteRegion(id, forbiddenSn, "region_forbidden", "forbidden");
                return;
            }
            if (parts[forbiddenIdx + 1] === "forbidden_create" && typeof state.val === "string") {
                this.createRegion(id, forbiddenSn, "region_forbidden", "forbidden");
                return;
            }
            if (parts[forbiddenIdx + 1] === "forbidden_points" && typeof state.val === "string") {
                this.createPreviewMap(id, "region_forbidden", state.val, forbiddenSn);
                return;
            }
        }
        const obstacleIdx = parts.indexOf("obstacles");
        if (obstacleIdx > 0) {
            const obstacleSn = parts[obstacleIdx - 2];
            if (parts[obstacleIdx + 2] === "delete_obstacle") {
                this.deleteRegion(id, obstacleSn, "region_obstacle", "obstacles");
                return;
            }
            if (parts[obstacleIdx + 1] === "obstacle_create" && typeof state.val === "string") {
                this.createRegion(id, obstacleSn, "region_obstacle", "obstacles");
                return;
            }
            if (parts[obstacleIdx + 1] === "obstacle_points" && typeof state.val === "string") {
                this.createPreviewMap(id, "region_obstacle", state.val, obstacleSn);
                return;
            }
        }
        const placed_blankIdx = parts.indexOf("placed_blank");
        if (placed_blankIdx > 0) {
            const placed_blankSn = parts[placed_blankIdx - 2];
            if (parts[placed_blankIdx + 2] === "delete_placed_blank") {
                this.deleteRegion(id, placed_blankSn, "region_placed_blank", "placed_blank");
                return;
            }
            if (parts[placed_blankIdx + 1] === "placed_blank_create" && typeof state.val === "string") {
                this.createRegion(id, placed_blankSn, "region_placed_blank", "placed_blank");
                return;
            }
            if (parts[placed_blankIdx + 1] === "placed_blank_points" && typeof state.val === "string") {
                this.createPreviewMap(id, "region_placed_blank", state.val, placed_blankSn);
                return;
            }
        }
        const blankIdx = parts.indexOf("blank");
        if (blankIdx > 0 && parts[blankIdx + 2] === "delete_blank") {
            const blankSn = parts[blankIdx - 2];
            this.deleteRegion(id, blankSn, "region_blank", "blank");
            return;
        }
        if (mapIdx > 0 && parts[mapIdx + 1]) {
            const snr = parts[mapIdx - 1];
            if (parts[mapIdx + 1] === "livemap_update" && state && typeof state.val === "boolean") {
                this.sunseeker.setLiveMap(snr, state.val);
                this.setState(id, { val: state.val, ack: true });
                return;
            }
            if (parts[mapIdx + 3] === "start_mowing_selected_area" && state && typeof state.val === "string") {
                this.startMowingSelectedArea(id, snr, state.val);
                this.setState(id, { val: state.val, ack: true });
                this.updateDeviceAfterStateChange(snr);
                return;
            }
            if (parts[mapIdx + 2] === "merge_zones") {
                this.mergeWorkArea(id, snr, "merge_zones", state);
                this.setState(id, { val: state.val, ack: true });
                this.updateDeviceAfterStateChange(snr);
                return;
            }
            if (parts[mapIdx + 2] === "settings_all_zones") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.setDefaultCustomMultiAngle(id, snr, state.val);
                }
                return;
            }
            const customIdx = parts.indexOf("custom");
            if (customIdx > 0) {
                const custom_multiIdx = parts.indexOf("multi_angle");
                if (custom_multiIdx > 0) {
                    if (parts[custom_multiIdx + 1] === "angle" || parts[custom_multiIdx + 1] === "angle_active") {
                        this.setState(id, { val: state.val, ack: true });
                        return;
                    }
                    if (parts[custom_multiIdx + 2] === "angle" || parts[custom_multiIdx + 2] === "active") {
                        this.editCustomZigZag(id, snr, state.val);
                        return;
                    }
                    if (parts[custom_multiIdx + 1] === "angle_create") {
                        this.createCustomZigZag(id, snr);
                        return;
                    }
                    if (parts[custom_multiIdx + 1] === "delete_angle") {
                        if (state && typeof state.val === "string") {
                            this.deleteCustomZigZag(id, snr, state.val);
                        }
                        return;
                    }
                }
                if (
                    parts[customIdx + 1] === "plan_mode" ||
                    parts[customIdx + 1] === "setting" ||
                    parts[customIdx + 1] === "start" ||
                    parts[customIdx + 1] === "work_gap" ||
                    parts[customIdx + 1] === "work_speed"
                ) {
                    this.editCustomSetting(id, snr, state.val, parts[customIdx + 1]);
                    return;
                }
                if (parts[customIdx + 1] === "setCustomZoneSettings") {
                    if (state.val) {
                        this.setCustomZoneSettings(id, snr);
                    }
                    return;
                }
                if (parts[customIdx + 1] === "setCustomRaw") {
                    if (typeof state.val === "string") {
                        this.setCustomRaw(id, snr, state.val);
                    }
                    return;
                }
            }
            if (parts[mapIdx + 2] === "change_active_map_name") {
                const mapId = await this.getStateAsync(`${snr}.map.zones.01.mapId`);
                if (mapId && typeof mapId.val === "number") {
                    const map_id = {
                        map_id: mapId.val,
                    };
                    this.sunseeker.setSettings(snr, state.val, "setMapName", "map_name", map_id);
                    this.setState(id, { val: state.val, ack: true });
                    this.updateDeviceAfterStateChange(snr);
                }
                return;
            }
            if (parts[mapIdx + 2] === "save_active_map") {
                const mapId = await this.getStateAsync(`${snr}.map.zones.01.mapId`);
                if (mapId && typeof mapId.val === "number" && mapId.val) {
                    this.sunseeker.sendCommand(snr, "backup_map", mapId.val);
                    this.setState(id, { val: false, ack: true });
                    this.updateDeviceAfterStateChange(snr);
                }
                return;
            }
            if (parts[mapIdx + 2] === "delete_active_map") {
                const del = await this.getStateAsync(`${snr}.map.zones.delete_active_map_select`);
                if (del && del.val) {
                    this.setState(`${snr}.map.zones.delete_active_map_select`, { val: false, ack: true });
                    const mapId = await this.getStateAsync(`${snr}.map.zones.01.mapId`);
                    if (mapId && typeof mapId.val === "number" && mapId.val) {
                        this.sunseeker.sendCommand(snr, "backup_delete_active", mapId.val);
                        this.setState(id, { val: false, ack: true });
                        this.updateDeviceAfterStateChange(snr);
                    }
                }
                return;
            }
            if (parts[mapIdx + 2] === "delete_active_map_select") {
                this.setState(id, { val: state.val, ack: true });
                return;
            }
            if (parts[mapIdx + 3] === "split_zones") {
                const lastIndex = id.lastIndexOf(".");
                if (lastIndex !== -1) {
                    const result = id.substring(0, lastIndex);
                    this.splitWorkArea(id, snr, result, "split_zones", state);
                    this.updateDeviceAfterStateChange(snr);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (parts[mapIdx + 3] === "mapName" && state && typeof state.val === "string") {
                const lastIndex = id.lastIndexOf(".");
                if (lastIndex !== -1) {
                    const result = id.substring(0, lastIndex);
                    const mapId = await this.getStateAsync(`${result}.mapId`);
                    if (mapId && typeof mapId.val === "number") {
                        const map_id = {
                            map_id: mapId.val,
                        };
                        this.sunseeker.setSettings(snr, state.val, "setMapName", "map_name", map_id);
                        this.setState(id, { val: state.val, ack: true });
                        this.updateDeviceAfterStateChange(snr);
                    }
                }
                return;
            }
            if (parts[mapIdx + 3] === "name" && state && typeof state.val === "string") {
                const lastIndex = id.lastIndexOf(".");
                if (lastIndex !== -1) {
                    const result = id.substring(0, lastIndex);
                    const zoneId = await this.getStateAsync(`${result}.id`);
                    if (zoneId && typeof zoneId.val === "number") {
                        const zoneId_id = {
                            region_id: zoneId.val,
                            region_name: state.val,
                            region_type: 0,
                        };
                        this.sunseeker.setSettings(snr, state.val, "setRegionName", "region_name", zoneId_id);
                        this.setState(id, { val: state.val, ack: true });
                        this.updateDeviceAfterStateChange(snr);
                    }
                }
                return;
            }
            if (parts[mapIdx + 3] === "useThisMap" && state && typeof state.val === "string") {
                const lastIndex = id.lastIndexOf(".");
                if (lastIndex !== -1) {
                    const result = id.substring(0, lastIndex);
                    const mapId = await this.getStateAsync(`${result}.mapId`);
                    const used = await this.getStateAsync(`${result}.used`);
                    if (mapId && typeof mapId.val === "number" && used && typeof used.val === "boolean" && !used.val) {
                        this.sunseeker.sendCommand(snr, "used", mapId.val);
                        this.setState(id, { val: false, ack: true });
                        this.updateDeviceAfterStateChange(snr);
                    }
                }
                return;
            }
            if (parts[mapIdx + 3] === "delete" && state && typeof state.val === "boolean") {
                const lastIndex = id.lastIndexOf(".");
                if (lastIndex !== -1) {
                    const result = id.substring(0, lastIndex);
                    const del = await this.getStateAsync(`${result}.delete_select`);
                    if (del && del.val) {
                        this.setState(`${result}.delete_select`, { val: false, ack: true });
                        const mapId = await this.getStateAsync(`${result}.mapId`);
                        if (mapId && typeof mapId.val === "number") {
                            this.sunseeker.sendCommand(snr, "backup_delete", mapId.val);
                            this.setState(id, { val: false, ack: true });
                            this.updateDeviceAfterStateChange(snr);
                        }
                    }
                }
                return;
            }
            if (parts[mapIdx + 3] === "delete_select" && state && typeof state.val === "boolean") {
                this.setState(id, { val: state.val, ack: true });
                return;
            }
        }
        const ownIdx = parts.indexOf("expert");
        if (
            ownIdx > 0 &&
            parts[ownIdx + 1] === "request" &&
            state &&
            typeof state.val === "string" &&
            state.val.startsWith("{")
        ) {
            this.sunseeker.ownRequest(parts[ownIdx - 1], state.val);
            this.setState(id, { val: state.val, ack: true });
            return;
        }
        const profileIdx = parts.indexOf("profile");
        if (profileIdx > 0 && parts[profileIdx + 2]) {
            const snDev = parts[profileIdx - 1];
            this.profileHandler(id, snDev, state);
            return;
        }
        const scheduleIdx = parts.indexOf("schedule");
        if (scheduleIdx > 0 && parts[scheduleIdx + 1]) {
            const sn = parts[scheduleIdx - 1];
            const leaf = parts[scheduleIdx + 1];
            if (leaf === "getSchedule") {
                this.sunseeker.fetchAllProperties(sn);
                this.setState(id, { val: false, ack: true });
                return;
            }
            if (leaf === "schedule_mode") {
                if (this.sunseeker && state.val != null && typeof state.val === "number") {
                    if (state.val == 0 || state.val == 1 || state.val == 2) {
                        this.sunseeker.setScheduleMode(sn, state.val);
                        this.setState(id, { val: false, ack: true });
                    }
                }
                return;
            }
            if (leaf === "setSchedule") {
                this.collectSchedulePlan(sn);
                this.setState(id, { val: false, ack: true });
                return;
            }
            if (leaf === "schedule_time_work_repeat") {
                if (typeof state.val === "boolean") {
                    this.sunseeker.setSettings(sn, state.val, "setTimeWorkRepeat", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
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
            const zigIdx = parts.indexOf("multi_angle");
            const leafZig = parts[zigIdx + 1];
            const leafZag = parts[zigIdx + 2];
            if (leafZig && leafZig === "angle") {
                this.setState(id, { val: state.val, ack: true });
                return;
            }
            if (leafZig && leafZig === "angle_active") {
                this.setState(id, { val: state.val, ack: true });
                return;
            }
            if (leafZig && leafZig === "angle_create") {
                this.createZigZag(id, sn);
                return;
            }
            if (leafZig && leafZig === "delete_angle" && typeof state.val === "string") {
                this.deleteZigZag(id, sn, state.val);
                return;
            }
            if (leafZag && (leafZag === "angle" || leafZag === "active")) {
                if (typeof state.val === "number" || typeof state.val === "boolean") {
                    this.sendZigZag(id, sn, 4, true);
                }
                return;
            }
            if (leaf === "topUp" && typeof state.val === "boolean") {
                this.setTopUpAndCheck(id, sn, state.val);
                return;
            }
            if (leaf === "topUp_array" && typeof state.val === "string" && state.val.startsWith("[")) {
                this.setTopUpArrayAndCheck(id, sn, state.val);
                return;
            }
            if (leaf === "pin_old") {
                if (typeof state.val === "string") {
                    const numberFormat = /^\d{4}$/;
                    if (numberFormat.test(state.val)) {
                        this.setState(id, { val: state.val, ack: true });
                    } else {
                        this.log.warn(`Wrong Pin format!! - ${state.val}`);
                    }
                }
                return;
            }
            if (leaf === "pin_new") {
                this.setNewPin(id, sn, state);
                return;
            }
            if (leaf === "firmware_update_start") {
                if (typeof state.val === "boolean") {
                    this.sunseeker.ota_upgrade(sn);
                    this.setState(id, { val: false, ack: true });
                }
                return;
            }
            if (leaf === "firmware_update_check_manual") {
                if (typeof state.val === "boolean") {
                    // FW Check for all devices
                    this.sunseeker.startUpdateCheck(false);
                    this.setState(id, { val: false, ack: true });
                }
                return;
            }
            if (leaf === "night_work") {
                if (typeof state.val === "boolean") {
                    this.setSettingsPromise(id, "boolean", sn, state, "setNightWork", leaf, null);
                }
                return;
            }
            if (leaf === "reset_bladeplate") {
                if (typeof state.val === "boolean" && state.val) {
                    this.sunseeker.sendCommand(sn, leaf, state.val);
                    this.setState(id, { val: false, ack: true });
                }
                return;
            }
            if (leaf === "reset_blade") {
                if (typeof state.val === "boolean" && state.val) {
                    this.sunseeker.sendCommand(sn, leaf, state.val);
                    this.setState(id, { val: false, ack: true });
                }
                return;
            }
            if (leaf === "reset_small_bladeplate") {
                if (typeof state.val === "boolean" && state.val) {
                    this.sunseeker.sendCommand(sn, leaf, state.val);
                    this.setState(id, { val: false, ack: true });
                }
                return;
            }
            if (leaf === "reset_small_blade") {
                if (typeof state.val === "boolean" && state.val) {
                    this.sunseeker.sendCommand(sn, leaf, state.val);
                    this.setState(id, { val: false, ack: true });
                }
                return;
            }
            if (leaf === "energy_saving_mode") {
                if (typeof state.val === "boolean") {
                    this.setSettingsPromise(id, "boolean", sn, state, "setEnergySavingMode", leaf, null);
                }
                return;
            }
            if (leaf === "follow_border_freq") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    this.setSettingsPromise(id, "number", sn, state, "setFollowBorderFreq", leaf, null);
                }
                return;
            }
            if (leaf === "power_off_sleep_mode") {
                if (typeof state.val === "boolean") {
                    this.setSettingsPromise(id, "boolean", sn, state, "setPowerOffSleepMode", leaf, null);
                }
                return;
            }
            if (leaf === "recharge_mode") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1 || state.val == 2)) {
                    this.setSettingsPromise(id, "number", sn, state, "setRechargeMode", leaf, null);
                }
                return;
            }
            if (leaf === "plan_mode") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1 || state.val == 3)) {
                    this.sendCommandPromise(leaf, id, sn, state);
                } else if (typeof state.val === "number" && state.val == 4) {
                    this.sendZigZag(id, sn, state.val, false);
                }
                return;
            }
            if (leaf === "dev_name") {
                if (typeof state.val === "string" && state.val != "") {
                    this.sendCommandPromise(leaf, id, sn, state);
                }
                return;
            }
            if (leaf === "auto_upgrade") {
                if (typeof state.val === "boolean") {
                    this.sendCommandPromise(leaf, id, sn, state);
                }
                return;
            }
            if (leaf === "dev_model") {
                if (typeof state.val === "string" && state.val != "") {
                    this.setSettingsPromise(id, "string", sn, state, "setDevModel", leaf, null);
                }
                return;
            }
            if (leaf === "workSpeed") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    this.setMowEfficiency(id, sn, null, state);
                }
                return;
            }
            if (leaf === "gap") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    this.setMowEfficiency(id, sn, state, null);
                }
                return;
            }
            if (leaf === "follow_border_laps") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    this.setSettingsPromise(id, "number", sn, state, "setFollowBorderLaps", leaf, null);
                }
                return;
            }
            if (leaf === "work_touch_mode") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.setSettingsPromise(id, "number", sn, state, "setWorkTouchMode", leaf, null);
                }
                return;
            }
            if (leaf === "auto_ride_edge_map_m") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.setSettingsPromise(id, "number", sn, state, "setAutoRideEdgeMapM", leaf, null);
                }
                return;
            }
            if (leaf === "custom_flag") {
                if (typeof state.val === "boolean") {
                    this.setSettingsPromise(id, "boolean", sn, state, "setCustomFlag", leaf, null);
                }
                return;
            }
            if (leaf === "first_along_border") {
                if (typeof state.val === "boolean") {
                    this.setSettingsPromise(id, "boolean", sn, state, "setFirstAlongBorder", leaf, null);
                }
                return;
            }
            if (leaf === "dis_along_border") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.setSettingsPromise(id, "number", sn, state, "setDisAlongBorder", leaf, null);
                }
                return;
            }
            if (leaf === "ai_sensitivity") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.setSettingsPromise(id, "number", sn, state, "setDisAlongBorder", leaf, null);
                }
                return;
            }
            if (leaf === "bladeSpeed" || leaf === "bladeHeight") {
                this.sendBlade(id, sn, leaf, state);
                return;
            }
            if (leaf === "rainFlag" || leaf === "rainDelayDuration") {
                this.sendRainFlag(id, sn, leaf, state);
                return;
            }
        }
        const remoteIdx = parts.indexOf("remote");
        if (remoteIdx < 0 || remoteIdx + 1 >= parts.length) {
            return;
        }
        if (!raw.online) {
            this.log.info(`onStateChange: Device ${parts[2]} is offline`);
        }
        const sn = parts[remoteIdx - 1];
        const command = parts[remoteIdx + 1];

        if (!this.sunseeker.devicesRaw[sn]) {
            this.log.warn(`onStateChange: Device ${sn} unknown`);
            return;
        }
        this.sendRemoteCommand(id, sn, command, state);
    }

    /**
     * @param {string} sn
     */
    async editBoundary(sn) {
        if (!this.sunseeker) {
            return;
        }
        const last_edge = [];
        const new_edge = [];
        const region_id = 123;
        await this.sunseeker.setDeviceProperty(sn, {
            id: "setDrawEdge",
            key: "draw_edge",
            area_info: [
                {
                    flag: 0,
                    last_edge: last_edge,
                    new_edge: new_edge,
                    region_id: region_id,
                    type: 0,
                },
            ],
        });
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {ioBroker.State | null} gap
     * @param {ioBroker.State | null} speed
     */
    async setMowEfficiency(id, sn, gap, speed) {
        if (!this.sunseeker) {
            return;
        }
        if (gap && typeof gap.val === "number") {
            const speeds = await this.getStateAsync(`${sn}.settings.workSpeed`);
            if (speeds && speeds.val != null && (speeds.val == 1 || speeds.val == 2 || speeds.val == 3)) {
                const status = await this.sunseeker.setMowEfficiency(sn, gap.val, speeds.val);
                if (status) {
                    await this.setState(id, { val: gap.val, ack: true });
                }
            }
        } else if (speed && typeof speed.val === "number") {
            const gaps = await this.getStateAsync(`${sn}.settings.gap`);
            if (gaps && gaps.val != null && (gaps.val == 1 || gaps.val == 2 || gaps.val == 3)) {
                const status = await this.sunseeker.setMowEfficiency(sn, gaps.val, speed.val);
                if (status) {
                    await this.setState(id, { val: speed.val, ack: true });
                }
            }
        }
    }

    /**
     * @param {string} objectId
     * @param {string} type
     * @param {string} sn
     * @param {ioBroker.State} state
     * @param {string} id
     * @param {string} key
     * @param {any} addValue
     */
    async setSettingsPromise(objectId, type, sn, state, id, key, addValue) {
        if (!this.sunseeker) {
            return;
        }
        if (typeof state.val === type) {
            const status = await this.sunseeker.setSettings(sn, state.val, id, key, addValue);
            if (status) {
                await this.setState(objectId, { val: state.val, ack: true });
            }
        }
    }

    /**
     * @param {string} id
     * @param {string} region
     * @param {string} state
     * @param {string} sn
     */
    async createPreviewMap(id, region, state, sn) {
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        if (!meta || !meta.mapJson || !meta.mapJson[region]) {
            this.log.warn(`${sn}: Missing device meta!`);
            return;
        }
        let points = [];
        const areas = JSON.parse(JSON.stringify(meta.mapJson));
        if (!Array.isArray(areas[region])) {
            this.log.warn(`Cannot find region - ${region}`);
            return;
        }
        if (state && typeof state === "string" && state.startsWith("[")) {
            try {
                points = JSON.parse(state);
            } catch (e) {
                this.log.warn(`Cannot parse points - ${e}`);
                return;
            }
        } else {
            this.log.warn(`Cannot found points!`);
            return;
        }
        let point = {
            points: "",
        };
        this.log.debug(region);
        let type_val;
        point.points = JSON.stringify(points);
        switch (region) {
            case "region_placed_blank":
                areas[region].push(point);
                break;
            case "region_obstacle":
                areas[region].push(point);
                break;
            case "region_customize":
                areas[region].push(point);
                break;
            case "region_forbidden":
                type_val = await this.getStateAsync(`${sn}.map.forbidden.forbidden_type`);
                type_val = await this.getStateAsync(`${sn}.map.forbidden.forbidden_type`);
                if (type_val && typeof type_val === "string" && type_val != "") {
                    point.type = type_val;
                } else {
                    this.log.warn(`Cannot found type!`);
                    return;
                }
                point.tag = 1;
                if (point.type == "dark") {
                    point.tag = 2;
                }
                areas[region].push(point);
                break;
            case "region_channel":
                areas[region].push(point);
                break;
            default:
                this.log.warn(`Region ${region} is unknwon!`);
                return;
        }
        if (points.length > 0) {
            this.sunseeker.fetchMapPreview(sn, region, areas);
            await this.setState(id, { val: state, ack: true });
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} region
     * @param {string} zone
     */
    async createRegion(id, sn, region, zone) {
        let points = [];
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        if (!meta || !meta.mapJson || !meta.mapJson[region]) {
            this.log.warn(`${sn}: Missing device meta!`);
            return;
        }
        const areas = meta.mapJson[region];
        let id_send = "";
        let key_send = "";
        /**
         * type = 0 region_work -> zones -> *
         * type = 1 region_blank -> blank -> map.blank
         * type = 2 region_channel -> passage area -> map.passages
         * type = 3 region_obstacle -> obstacle area -> map.obstacles
         * type = 4 region_forbidden -> forbidden area -> map.forbidden
         * type = 6 region_customize
         * type = 8 region_placed_blank -> safe area -> map.placed_blank
         * type = 12 region_forbid_trim
         * type = ? divide_area_work
         * MAP_TYPE_BATCH_DELETE = 11
         * MAP_TYPE_EDIT_EDGE = 5
         * MAP_TYPE_PASS_CHARGE = 9
         * MAP_TYPE_POINT_CUT = 10
         */
        let type = "";
        let point = "";
        let tag = 1;
        let type_val;
        switch (zone) {
            case "passages":
                point = "passage";
                break;
            case "forbidden":
                type_val = await this.getStateAsync(`${sn}.map.forbidden.forbidden_type`);
                if (type_val && typeof type_val === "string" && type_val != "") {
                    type = type_val;
                } else {
                    this.log.warn(`Cannot found type!`);
                    return;
                }
                point = "forbidden";
                if (type == "dark") {
                    tag = 2;
                    type = "dark";
                } else if (type == "wall") {
                    tag = 1;
                    type = "normal";
                }
                id_send = "setForbidArea";
                key_send = "forbid_area";
                break;
            case "obstacles":
                //ToDo search id & key
                id_send = "";
                key_send = "";
                point = "";
                break;
            case "placed_blank":
                id_send = "setPlacedBlankArea";
                key_send = "placed_blank_area";
                point = "placed_blank";
                break;
            case "blank":
                //ToDo search type, id & key
                id_send = "";
                key_send = "";
                point = "";
                break;
            default:
                this.log.warn(`Type ${zone} is unknwon!`);
        }
        if (id_send == "") {
            return;
        }
        const all = [];
        let new_json;
        const point_val = await this.getStateAsync(`${sn}.map.forbidden.${point}_points`);
        if (point_val && typeof point_val.val === "string" && point_val.val.startsWith("[")) {
            try {
                points = JSON.parse(point_val.val);
            } catch (e) {
                this.log.warn(`Cannot parse points - ${e}`);
                return;
            }
        } else {
            this.log.warn(`Cannot found points!`);
            return;
        }
        if (zone == "passages" && points.length > 0) {
            this.sunseeker.sendCommand(sn, "passages", points);
            await this.setState(id, { val: false, ack: true });
            this.updateDeviceAfterStateChange(sn);
            return;
        }
        new_json = {
            map_id: new Date().getTime() - 58535,
            vertexs: points,
        };
        if (zone == "forbidden") {
            if (type != "") {
                new_json["type"] = type;
            }
            new_json["tag"] = tag;
        }
        if (areas.length > 0) {
            for (const area of areas) {
                const map = {
                    map_id: area.id,
                    type: area.type,
                    tag: area.tag,
                    vertexs: area.points,
                };
                all.push(map);
            }
        }
        all.push(new_json);
        await this.sunseeker.setDeviceProperty(sn, {
            id: id_send,
            key: key_send,
            area_info: all,
        });
        await this.setState(id, { val: false, ack: true });
        this.updateDeviceAfterStateChange(sn);
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} region
     * @param {string} [zone]
     */
    async deleteRegion(id, sn, region, zone) {
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        if (!meta || !meta.mapJson || !meta.mapJson[region]) {
            this.log.warn(`${sn}: Missing device meta!`);
            return;
        }
        const area = meta.mapJson[region];
        const parts = id.split(".");
        const nr = Number(parts[5]);
        const area_obj = await this.loadChannels(sn, `map.${zone}.0`, false);
        const areas = Object.keys(area_obj).length;
        if (areas < 0) {
            this.log.warn(`Cannot found areas from ${id}`);
            return;
        }
        let type = -1;
        switch (zone) {
            case "passages":
                type = 2;
                break;
            case "forbidden":
                type = 4;
                break;
            case "obstacles":
                type = 3;
                break;
            case "placed_blank":
                type = 8;
                break;
            case "blank":
                //ToDo search type
                type = -1;
                break;
            default:
                this.log.warn(`Type ${zone} is unknwon!`);
        }
        if (typeof nr === "number" && type !== -1) {
            const map_id = await this.getStateAsync(`${sn}.map.${zone}.${parts[5]}.id`);
            if (map_id && typeof map_id.val === "number") {
                const map_check = area.filter(m => m.id == map_id.val);
                if (map_check) {
                    await this.sunseeker.setDeviceProperty(sn, {
                        id: "deleteRegions",
                        key: "delete_region",
                        region_info: [{ region_id: map_id.val, type: type }],
                    });
                    await this.setState(id, { val: false, ack: true });
                    this.updateDeviceAfterStateChange(sn);
                } else {
                    this.log.warn(`Cannot found map_id ${map_id.val}`);
                }
            } else {
                this.log.warn(`Cannot found map_id/timestamp from ${sn}.map.${zone}.${parts[5]}.id`);
            }
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {ioBroker.State} state
     */
    async setNewPin(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        if (typeof state.val === "string") {
            const numberFormat = /^\d{4}$/;
            if (numberFormat.test(state.val)) {
                const pin_old = await this.getStateAsync(`${sn}.settings.pin_old`);
                if (pin_old && typeof pin_old.val === "string") {
                    if (numberFormat.test(pin_old.val)) {
                        const status = await this.sunseeker.changePin(sn, pin_old.val, state.val);
                        if (status) {
                            await this.setState(id, { val: "", ack: true });
                            await this.setState(`${sn}.settings.pin_old`, { val: "", ack: true });
                        }
                    } else {
                        this.log.warn(`Wrong old pin format!! - ${state.val}`);
                    }
                } else {
                    this.log.warn(`Missing old pin!! - ${state.val}`);
                }
            } else {
                this.log.warn(`Wrong new pin format!! - ${state.val}`);
            }
        }
    }

    /**
     * @param {string} type
     * @param {string} id
     * @param {string} sn
     * @param {ioBroker.State} state
     */
    async sendCommandPromise(type, id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        if (type == "plan_mode" && typeof state.val === "number") {
            const status = await this.sunseeker.setPlanMode(sn, state.val, null);
            if (status) {
                await this.setState(id, { val: state.val, ack: true });
            }
            return;
        } else if (type == "dev_name") {
            const status = await this.sunseeker.setDeviceName(sn, state);
            if (status) {
                await this.setState(id, { val: "", ack: true });
            }
            return;
        } else if (type == "auto_upgrade" && typeof state.val === "boolean") {
            const status = await this.sunseeker.setAutoUpgrade(sn, state);
            if (status) {
                this.setState(id, { val: state.val, ack: true });
            }
            return;
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {ioBroker.State} state
     */
    async profileHandler(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        const parts = id.split(".");
        const command = parts.pop();
        const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,20}$/;
        let text = "";
        let path = "";
        if (command === "step1_oldPassword") {
            if (this.config.password != state.val) {
                text = "The old password is incorrect.";
                path = "password.step4_message";
            } else {
                text = "OK";
                await this.setState(id, { val: state.val, ack: true });
            }
        } else if (command === "step2_newPassword") {
            path = "password.step4_message";
            if (typeof state.val === "string") {
                if (!regex.test(state.val)) {
                    text =
                        "The password must have minimum eight characters, maximum twenty characters," +
                        " at least one uppercase letter, one lowercase letter and one number.";
                } else {
                    text = "OK";
                    await this.setState(id, { val: state.val, ack: true });
                }
            } else {
                text = "The old password is not a character string.";
            }
        } else if (command === "step3_newPassword_repeat") {
            const oldPw = await this.getStateAsync(`profile.password.step1_oldPassword`);
            if (
                !oldPw ||
                !oldPw.val ||
                typeof state.val !== "string" ||
                oldPw.val != state.val ||
                !regex.test(state.val)
            ) {
                text = "The password does not match.";
            } else if (oldPw.val === state.val) {
                const status = await this.sunseeker.changePassword(oldPw.val, state.val);
                if (status) {
                    await this.setState(id, { val: false, ack: true });
                    await this.setState(`profile.password.step1_oldPassword`, { val: "", ack: true });
                    await this.setState(`profile.password.step2_newPassword`, { val: "", ack: true });
                    await this.setState(`profile.password.step3_newPassword_repeat`, { val: "", ack: true });
                    this.sunseeker.stop();
                    this.log.info(`Please change the password in the instance settings.`);
                    text = "The password has been changed. Please change the password in the instance settings.";
                } else {
                    text = "Password was not changed!";
                }
            } else {
                text = "Unknown error.";
            }
        } else if (command === "step1_newEmail") {
            this.changeMail = {
                appType: 3,
                appVersion: "",
                code: "",
                newUserName: "",
                operatingSystemCode: "android",
                randomStr: "",
            };
            path = "mail.step7_message";
            if (typeof state.val === "string") {
                if (this.config.username === state.val) {
                    text = "This is the email from the adapter settings.";
                } else if (!this.isValidSyntax(state.val)) {
                    text = "Email is invalid.";
                } else {
                    this.changeMail.newUserName = state.val;
                    await this.setState(id, { val: state.val, ack: true });
                    text = "OK";
                }
            } else {
                text = "The email is not a character string.";
            }
        } else if (command === "step2_checkNewEmail") {
            const mail = await this.getStateAsync(`profile.mail.step1_newEmail`);
            if (!mail || !mail.val || mail.val != this.changeMail.newUserName || mail.val == "") {
                this.changeMail.newUserName = "";
                this.changeMail.randomStr = "";
                await this.setState(`profile.mail.step3_randomString`, { val: "", ack: true });
                await this.setState(`profile.mail.step1_newEmail`, { val: "", ack: true });
                text = "The email has been changed!";
            } else if (typeof this.changeMail.newUserName === "string" && this.changeMail.newUserName != "") {
                const status = await this.sunseeker.checkEmail(this.changeMail.newUserName);
                if (status) {
                    const uuid = this.sunseeker.uuidv4();
                    this.changeMail.randomStr = uuid;
                    await this.setState(`profile.mail.step3_randomString`, { val: uuid, ack: true });
                    await this.setState(`profile.mail.step2_checkNewEmail`, { val: false, ack: true });
                    text = "OK";
                } else {
                    text = "This email is already in use.!";
                }
            } else {
                this.changeMail.newUserName = "";
                this.changeMail.randomStr = "";
                text = "Unknown error!";
            }
        } else if (command === "step4_createVerificationCode") {
            const mail = await this.getStateAsync(`profile.mail.step1_newEmail`);
            const random = await this.getStateAsync(`profile.mail.step3_randomString`);
            if (
                !mail ||
                !mail.val ||
                mail.val != this.changeMail.newUserName ||
                mail.val == "" ||
                !random ||
                !random.val ||
                random.val != this.changeMail.randomStr ||
                random.val == ""
            ) {
                this.changeMail.newUserName = "";
                this.changeMail.randomStr = "";
                await this.setState(`profile.mail.step3_randomString`, { val: "", ack: true });
                await this.setState(`profile.mail.step1_newEmail`, { val: "", ack: true });
                text = "The email or random string has been changed!";
            } else if (
                typeof this.changeMail.newUserName === "string" &&
                this.changeMail.newUserName != "" &&
                typeof this.changeMail.randomStr === "string" &&
                this.changeMail.randomStr != ""
            ) {
                const status = await this.sunseeker.createVerifyCode(
                    this.changeMail.newUserName,
                    this.changeMail.randomStr,
                );
                if (status) {
                    await this.setState(`profile.mail.step4_createVerificationCode`, { val: false, ack: true });
                    text = "OK";
                } else {
                    text = "Unknown error! The code was not sent!";
                }
            } else {
                this.changeMail.newUserName = "";
                this.changeMail.randomStr = "";
                text = "Unknown error.";
            }
        } else if (command === "step5_verificationCode") {
            if (state && typeof state.val === "string" && state.val.length === 4) {
                this.changeMail.code = state.val;
                text = "OK";
                await this.setState(`profile.mail.step5_verificationCode`, { val: state.val, ack: true });
            } else {
                text = "The code may only have four characters";
            }
        } else if (command === "step6_changeEmail") {
            const mail = await this.getStateAsync(`profile.mail.step1_newEmail`);
            const random = await this.getStateAsync(`profile.mail.step3_randomString`);
            const code = await this.getStateAsync(`profile.mail.step5_verificationCode`);
            if (
                !mail ||
                !mail.val ||
                mail.val != this.changeMail.newUserName ||
                mail.val == "" ||
                !random ||
                !random.val ||
                random.val != this.changeMail.randomStr ||
                random.val == "" ||
                !code ||
                !code.val ||
                code.val != this.changeMail.code ||
                code.val == ""
            ) {
                this.changeMail.newUserName = "";
                this.changeMail.randomStr = "";
                this.changeMail.code = "";
                await this.setState(`profile.mail.step3_randomString`, { val: "", ack: true });
                await this.setState(`profile.mail.step1_newEmail`, { val: "", ack: true });
                await this.setState(`profile.mail.step5_verificationCode`, { val: "", ack: true });
                text = "The email, random string or code has been changed!";
            } else if (
                typeof this.changeMail.newUserName === "string" &&
                this.changeMail.newUserName != "" &&
                typeof this.changeMail.randomStr === "string" &&
                this.changeMail.randomStr != "" &&
                typeof this.changeMail.code === "string" &&
                this.changeMail.code != ""
            ) {
                const status = await this.sunseeker.changeEmail(this.changeMail);
                if (status) {
                    await this.setState(`profile.mail.step6_changeEmail`, { val: false, ack: true });
                    await this.setState(`profile.mail.step3_randomString`, { val: "", ack: true });
                    await this.setState(`profile.mail.step1_newEmail`, { val: "", ack: true });
                    await this.setState(`profile.mail.step5_verificationCode`, { val: "", ack: true });
                    text =
                        "The email address has been changed. Please enter the new email address into the adapter settings.";
                } else {
                    text = "The email was not changed!";
                }
            } else {
                this.changeMail.newUserName = "";
                this.changeMail.randomStr = "";
                this.changeMail.code = "";
                text = "Unknown error.";
            }
        } else if (
            command === "daylight_time_auto_set" ||
            command === "daylight_time_enable" ||
            command === "changeTimezone"
        ) {
            // ToDo Use meta
            const lat = await this.getStateAsync(`${sn}.mower_raw.lat`);
            const lng = await this.getStateAsync(`${sn}.mower_raw.lng`);
            if (!lat || lat.val == null || typeof lat.val !== "number") {
                this.log.warn(`Missing latitude`);
                return;
            }
            if (!lng || lng.val == null || typeof lng.val !== "number") {
                this.log.warn(`Missing longitude`);
                return;
            }
            const timezone = this.sunseeker.getGmtOffset(lat.val, lng.val);
            if (!timezone) {
                this.log.warn(`Missing time zone data`);
                return;
            }
            const addValue = {
                daylight_time_auto_set: false,
                daylight_time_enable: false,
                timeZoneCode: timezone.gmtShort,
                timeZoneId: timezone.tz,
            };
            const idSet = "updateTimezone";
            const key = "time_zone";
            const gmt = this.sunseeker.timezoneValue();
            const timezoneCode = this.sunseeker.timezoneCode();
            if (!gmt || gmt[timezone.gmtShort] == null) {
                this.log.warn(`Missing gmt data`);
                return;
            }
            let value = gmt[timezone.gmtShort];
            if (command === "daylight_time_auto_set") {
                addValue.daylight_time_auto_set = typeof state.val === "boolean" ? state.val : false;
                const enable = await this.getStateAsync(`${sn}.profile.timezone.daylight_time_enable`);
                if (enable && typeof enable.val === "boolean") {
                    addValue.daylight_time_enable = enable.val;
                }
                const status = await this.sunseeker.setSettings(sn, value, idSet, key, addValue);
                if (status) {
                    await this.setState(id, { val: state.val, ack: true });
                }
            } else if (command === "daylight_time_enable") {
                addValue.daylight_time_enable = typeof state.val === "boolean" ? state.val : false;
                const auto = await this.getStateAsync(`${sn}.profile.timezone.daylight_time_auto_set`);
                if (auto && typeof auto.val === "boolean") {
                    addValue.daylight_time_auto_set = auto.val;
                }
                const status = await this.sunseeker.setSettings(sn, value, idSet, key, addValue);
                if (status) {
                    await this.setState(id, { val: state.val, ack: true });
                }
            } else if (command === "changeTimezone") {
                if (state && typeof state.val === "string") {
                    const tzCode = timezoneCode[state.val];
                    const gmtCode = tzCode.split(" ");
                    value = gmt[gmtCode[1]];
                    addValue.timeZoneId = state.val;
                    const status = await this.sunseeker.setSettings(sn, value, idSet, key, addValue);
                    if (status) {
                        await this.setState(id, { val: state.val, ack: true });
                    }
                }
            }
            return;
        } else if (command === "country") {
            if (state && typeof state.val === "string") {
                const country = this.sunseeker.getRegionISO();
                if (country[state.val]) {
                    const status = await this.sunseeker.setCountry(state.val);
                    if (status) {
                        await this.setState(id, { val: state.val, ack: true });
                    } else {
                        this.log.warn(`Unknown error!`);
                    }
                } else {
                    this.log.warn(`Wrong value type`);
                }
            } else {
                this.log.warn(`Wrong country ${state.val}`);
            }
            return;
        }
        if (text != "") {
            await this.setState(`${sn}.profile.${path}`, { val: text, ack: true, expire: 60000 });
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {ioBroker.State} state
     */
    async patternHandler(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        if (!meta || !meta.mapJson || !meta.mapJson.region_customize) {
            this.log.warn(`${sn}: Missing device meta!`);
            return;
        }
        const customize = meta.mapJson.region_customize;
        const parts = id.split(".");
        const nr = Number(parts[5]);
        const command = parts.pop();
        let all = [];
        let img = null;
        let points = undefined;
        switch (command) {
            case "create_pattern":
                if (customize.length > 0) {
                    for (const pattern of customize) {
                        const oldPattern = {
                            img_value: pattern.img_value,
                            last_edit_time: pattern.last_edit_time,
                            min_width: pattern.min_width,
                            vertexs: pattern.points,
                            img_id: pattern.id,
                        };
                        all.push(oldPattern);
                    }
                }
                img = await this.getStateAsync(`${sn}.map.pattern.selecte_pattern`);
                points = await this.getStateAsync(`${sn}.map.pattern.points_pattern`);
                if (
                    img &&
                    typeof img.val === "string" &&
                    meta.pattern[img.val] != null &&
                    points &&
                    typeof points.val === "string" &&
                    points.val.startsWith("[")
                ) {
                    try {
                        const actTime = new Date().getTime();
                        const newPattern = {
                            img_value: img.val,
                            last_edit_time: actTime,
                            min_width: this.sunseeker.patternSize(img.val),
                            vertexs: JSON.parse(points.val),
                            img_id: actTime - 58535,
                        };
                        all.push(newPattern);
                        await this.sunseeker.setDeviceProperty(sn, {
                            id: "setCustomizeArea",
                            key: "customize_area",
                            custom_area_info: all,
                        });
                        if (this.patternTimeout[sn]) {
                            this.log.warn(`Timeout is running!!!`);
                            return;
                        }
                        this.updateDeviceAfterStateChange(sn);
                        this.patternTimeout[sn] = this.setTimeout(async () => {
                            this.patternTimeout[sn] = null;
                            if (this.sunseeker) {
                                await this.sunseeker.setDeviceProperty(sn, {
                                    id: "setCustomizeArea",
                                    key: "customize_area",
                                    custom_area_info: [],
                                });
                            }
                        }, 10 * 1000);
                        await this.setState(id, { val: state.val, ack: true });
                    } catch (e) {
                        this.log.error(`Parse error: ${e}`);
                    }
                }
                break;
            case "delete_all_pattern":
                if (state && typeof state.val === "boolean" && state.val) {
                    await this.sunseeker.setDeviceProperty(sn, {
                        id: "setCustomizeArea",
                        key: "customize_area",
                        custom_area_info: [],
                    });
                    await this.setState(id, { val: false, ack: true });
                    this.updateDeviceAfterStateChange(sn);
                }
                break;
            case "delete_automatic":
                if (state && typeof state.val === "number") {
                    const val = await this.sunseeker.setPatternExpirationTime(sn, state.val);
                    if (val) {
                        await this.setState(id, { val: state.val, ack: true });
                        this.updateDeviceAfterStateChange(sn);
                    }
                }
                break;
            case "selecte_pattern":
                if (state && typeof state.val === "string" && meta.pattern[state.val] != null) {
                    await this.setState(id, { val: state.val, ack: true });
                }
                break;
            case "pattern_delete":
                if (typeof nr === "number") {
                    const pattern_obj = await this.loadChannels(sn, "map.pattern.0", false);
                    const patterns = Object.keys(pattern_obj).length;
                    if (patterns == 1) {
                        await this.sunseeker.setDeviceProperty(sn, {
                            id: "setCustomizeArea",
                            key: "customize_area",
                            custom_area_info: [],
                        });
                        await this.setState(id, { val: false, ack: true });
                        this.updateDeviceAfterStateChange(sn);
                    } else if (patterns > 1) {
                        const img_id = await this.getStateAsync(`${sn}.map.pattern.${parts[5]}.id`);
                        if (img_id && typeof img_id.val === "number") {
                            for (const pattern of customize) {
                                const oldPattern = {
                                    img_value: pattern.img_value,
                                    last_edit_time: pattern.last_edit_time,
                                    min_width: pattern.min_width,
                                    vertexs: pattern.points,
                                    img_id: pattern.id,
                                };
                                if (pattern.id != img_id.val) {
                                    all.push(oldPattern);
                                }
                            }
                            if (all.length > 0) {
                                await this.sunseeker.setDeviceProperty(sn, {
                                    id: "setCustomizeArea",
                                    key: "customize_area",
                                    custom_area_info: all,
                                });
                                await this.delObjectAsync(
                                    `${this.namespace}.${sn}.map.pattern.${`0${patterns}`.slice(-2)}`,
                                    {
                                        recursive: true,
                                    },
                                );
                                this.json2iob.resetCache(`${sn}.map.pattern.${`0${patterns}`.slice(-2)}`);
                                await this.setState(id, { val: false, ack: true });
                                this.updateDeviceAfterStateChange(sn);
                            }
                        }
                    }
                }
                break;
            case "img_value":
                if (
                    typeof nr === "number" &&
                    state &&
                    typeof state.val === "string" &&
                    meta.pattern[state.val] != null
                ) {
                    const img_id = await this.getStateAsync(`${sn}.map.pattern.${parts[5]}.id`);
                    if (img_id && typeof img_id.val === "number") {
                        for (const pattern of customize) {
                            const oldPattern = {
                                img_value: pattern.img_value,
                                last_edit_time: pattern.last_edit_time,
                                min_width: pattern.min_width,
                                vertexs: pattern.points,
                                img_id: pattern.id,
                            };
                            if (pattern.id == img_id.val) {
                                oldPattern.img_value = state.val;
                                oldPattern.last_edit_time = new Date().getTime();
                            }
                            all.push(oldPattern);
                        }
                        if (all.length > 0) {
                            await this.sunseeker.setDeviceProperty(sn, {
                                id: "setCustomizeArea",
                                key: "customize_area",
                                custom_area_info: all,
                            });
                            await this.setState(id, { val: state.val, ack: true });
                            this.updateDeviceAfterStateChange(sn);
                        }
                    }
                }
                break;
            default:
                this.log.warn(`Command ${command} is unknwon!`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} command
     * @param {ioBroker.State} state
     */
    async sendBlade(id, sn, command, state) {
        if (!this.sunseeker) {
            return;
        }
        const key = command === "bladeSpeed" ? "speed" : "height";
        try {
            const status = await this.sunseeker.setBlade(sn, key, Number(state.val));
            if (status) {
                this.updateDeviceAfterStateChange(sn);
                await this.setState(id, { val: state.val, ack: true });
            }
        } catch (err) {
            this.log.error(`Blade-${key} for ${sn} failed: ${err.message}`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} set
     * @param {number | boolean} state
     */
    async setAntiTheft(id, sn, set, state) {
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        if (!meta) {
            this.log.warn(`${sn}: Missing deviceMeta!`);
            return;
        }
        if (!meta.fenceRadiusSettingId) {
            this.log.warn(`${sn}: Missing radius!`);
            return;
        }
        if (!meta.mapLon) {
            this.log.warn(`${sn}: Missing mapLon!`);
            return;
        }
        if (!meta.mapLat) {
            this.log.warn(`${sn}: Missing mapLat!`);
            return;
        }
        if (!meta.antiTheftSn) {
            this.log.warn(`${sn}: Missing antiTheftSn!`);
            return;
        }
        let data = {};
        if (set === "fence") {
            data = {
                fenceCenterLat: meta.mapLat,
                fenceCenterLon: meta.mapLon,
                fenceRadiusSettingId: state.toString(),
                fenceStatus: "1",
                sn: meta.antiTheftSn,
            };
        } else if (set === "fence_digital") {
            data = {
                fenceCenterLat: meta.mapLat,
                fenceCenterLon: meta.mapLon,
                fenceRadiusSettingId: meta.fenceRadiusSettingId,
                fenceStatus: state ? "1" : "0",
                sn: meta.antiTheftSn,
            };
        }
        if (Object.keys(data).length > 0) {
            const resp = await this.sunseeker.setAntiTheftX(data);
            if (resp) {
                this.sunseeker.updateTheft(sn);
                await this.setState(id, { val: state, ack: true });
            }
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} command
     * @param {ioBroker.State} state
     */
    async sendRainFlag(id, sn, command, state) {
        if (!this.sunseeker) {
            return;
        }
        try {
            const flagVal =
                command === "rainFlag" ? state.val : (await this.getStateAsync(`${sn}.settings.rainFlag`))?.val;
            const durVal =
                command === "rainDelayDuration"
                    ? state.val
                    : (await this.getStateAsync(`${sn}.settings.rainDelayDuration`))?.val;
            const status = await this.sunseeker.setRain(sn, Boolean(flagVal), Math.round(Number(durVal) || 0));
            if (status) {
                this.updateDeviceAfterStateChange(sn);
                await this.setState(id, { val: state.val, ack: true });
            }
        } catch (err) {
            this.log.error(`Rain delay for ${sn} failed: ${err.message}`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} command
     * @param {ioBroker.State} state
     */
    async sendRemoteCommand(id, sn, command, state) {
        if (!this.sunseeker) {
            return;
        }
        try {
            if (command === "refresh") {
                await this.sunseeker.updateDevice(sn);
            } else if (command === "refresh_property") {
                await this.sunseeker.fetchInitialProperties();
            } else if (command === "set_screen_duration") {
                await this.sunseeker.sendCommand(sn, command, state.val);
            } else if (command === "set_return_path") {
                await this.sunseeker.sendCommand(sn, command, state.val);
            } else if (command === "set_border_first") {
                await this.sunseeker.sendCommand(sn, command, state.val);
            } else if (command === "set_border_distance") {
                await this.sunseeker.sendCommand(sn, command, state.val);
            } else if (command === "startZones") {
                if (typeof state.val === "string" && state.val.startsWith("[")) {
                    const mapids = JSON.parse(state.val);
                    await this.sunseeker.sendCommand(sn, "start", mapids);
                }
            } else {
                await this.sunseeker.sendCommand(sn, command, state.val);
                this.updateDeviceAfterStateChange(sn);
            }
            await this.setState(id, { val: state.val, ack: true });
        } catch (err) {
            this.log.error(`Command ${command} for ${sn} failed: ${err.message}`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} state
     */
    async setCustomRaw(id, sn, state) {
        if (typeof state === "string" && state.startsWith("{") && this.sunseeker) {
            try {
                const raw = JSON.parse(state);
                this.log.debug(JSON.stringify(raw));
                if (raw.plan_mode === 2 || raw.plan_mode > 4 || raw.plan_mode < 0) {
                    this.log.error(`plan_mode: Only 0, 1. 3 and 4 are allowed!`);
                    return;
                }
                if (raw.start !== 0 && raw.start !== 1) {
                    this.log.error(`start: Only 0 and 1 are allowed!`);
                    return;
                }
                if (raw.setting !== true && raw.setting !== false) {
                    this.log.error(`setting: Only 0 and 1 are allowed!`);
                    return;
                }
                if (raw.work_speed > 3 || raw.work_speed < 1) {
                    this.log.error(`work_speed: Only 1, 2 and 3 are allowed!`);
                    return;
                }
                if (raw.work_gap > 3 || raw.work_gap < 1) {
                    this.log.error(`work_gap: Only 1, 2 and 3 are allowed!`);
                    return;
                }
                this.sunseeker.setSettings(sn, raw, "setCustom", "custom", null);
                await this.setState(id, { val: "", ack: true });
            } catch (e) {
                this.log.error(`setCustomRaw: ${e}`);
            }
        }
    }

    /**
     * @param {string} id
     * @param {string} snr
     */
    async setCustomZoneSettings(id, snr) {
        const zones = id.split(".");
        const zone = zones[5];
        const raw = await this.getRaw(snr, zone);
        if (raw && Object.keys(raw).length > 0) {
            await this.setCustomRaw(id, snr, raw);
        }
    }

    /**
     * @param {string} id
     * @param {string} snr
     * @param {string | number | boolean | null} state
     * @param {string} command
     */
    async editCustomSetting(id, snr, state, command) {
        const zones = id.split(".");
        const zone = zones[5];
        const raw = await this.getRaw(snr, zone);
        if (raw && Object.keys(raw).length > 0) {
            this.log.debug(JSON.stringify(raw));
            if (raw[command] != null) {
                if (command === "start") {
                    raw[command] = state ? true : false;
                } else {
                    raw[command] = state;
                }
                await this.setState(`${this.namespace}.${snr}.map.zones.${zone}.custom.setCustomRaw`, {
                    val: JSON.stringify(raw),
                    ack: true,
                    expire: 60,
                });
                await this.setState(id, { val: state, ack: true });
            }
        } else {
            this.log.warn(`Cannot found custom raw!`);
        }
    }

    /**
     * @param {string} id
     * @param {string} snr
     * @param {string | number | boolean | null} state
     */
    async editCustomZigZag(id, snr, state) {
        const zones = id.split(".");
        const zone = zones[5];
        const zig = Number(zones[8]);
        const raw = await this.getRaw(snr, zone);
        const obj = typeof state === "boolean" ? "active" : "angle";
        if (raw && Object.keys(raw).length > 0) {
            this.log.debug(JSON.stringify(raw));
            raw.multi_zigzag_angles[zig - 1][obj] = state;
            await this.setState(`${this.namespace}.${snr}.map.zones.${zone}.custom.setCustomRaw`, {
                val: JSON.stringify(raw),
                ack: true,
                expire: 60,
            });
            await this.setState(id, { val: state, ack: true });
        } else {
            this.log.warn(`Cannot found custom raw!`);
        }
    }

    /**
     * @param {string} sn
     * @param {string} zone
     */
    async getRaw(sn, zone) {
        const path = `${this.namespace}.${sn}.map.zones.${zone}.custom.setCustomRaw`;
        const edit_raw = await this.getStateAsync(path);
        const actual_time = new Date().getTime();
        let diff = 60001;
        if (edit_raw && edit_raw.lc != null) {
            diff = actual_time - edit_raw.lc;
        }
        if (edit_raw && typeof edit_raw.val === "string" && edit_raw.val.startsWith("{") && diff < 60001) {
            return JSON.parse(edit_raw.val);
        }
        const state_raw = await this.getStateAsync(`${this.namespace}.${sn}.map.zones.${zone}.custom.currentCustomRaw`);
        if (state_raw && typeof state_raw.val === "string" && state_raw.val.startsWith("{")) {
            return JSON.parse(state_raw.val);
        }
        return null;
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {number} state
     */
    async setDefaultCustomMultiAngle(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        if (!meta) {
            this.log.warn(`${sn}: Missing deviceMeta!`);
            return;
        }
        this.log.debug(`setDefaultCustomMultiAngle: ${sn} - ${state} - ${JSON.stringify(meta.custom_multi_sort)}`);
        const count_sort = Object.keys(meta.custom_multi_sort).length;
        if (count_sort > 0) {
            const region = [];
            for (const id in meta.custom_multi_sort) {
                const val = {
                    region_id: typeof id === "number" ? id : Number(id),
                    setting: state == 0 ? false : true,
                };
                region.push(val);
            }
            this.log.debug(JSON.stringify(region));
            this.sunseeker.setSettings(sn, region, "setCustom", "custom", null);
            this.setState(id, { val: state, ack: true });
        } else {
            this.log.warn(`${sn}: Missing region id ${meta.custom_multi_sort}`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     */
    async createCustomZigZag(id, sn) {
        if (!this.sunseeker) {
            return;
        }
        const id_new = id.replace(".angle_create", "");
        const lastIndex = id_new.lastIndexOf(".");
        if (lastIndex !== -1) {
            const result = id_new.substring(0, lastIndex);
            const raw = await this.getStateAsync(`${result}.currentCustomRaw`);
            if (raw && typeof raw.val === "string" && raw.val.startsWith("{")) {
                try {
                    const json = JSON.parse(raw.val);
                    if (!json.multi_zigzag_angles) {
                        json.multi_zigzag_angles = [];
                    }
                    if (json.multi_zigzag_angles.length == 4) {
                        this.log.warn(`${sn} - Only 4 multi-angles can be created.`);
                        return;
                    }
                    const active = await this.getStateAsync(`${id_new}.angle_active`);
                    const angle = await this.getStateAsync(`${id_new}.angle`);
                    if (active && active.val != null && angle && typeof angle.val === "number") {
                        const zz = {
                            active: active.val ? true : false,
                            angle: angle.val >= 0 && angle.val <= 180 ? angle.val : 90,
                        };
                        json.multi_zigzag_angles.push(zz);
                        json.plan_mode = 4;
                        json.setting = true;
                        this.sunseeker.setSettings(sn, json, "setCustom", "custom", null);
                        this.setState(id, { val: false, ack: true });
                    } else {
                        this.log.warn(`Cannot found active and angle!`);
                    }
                } catch (e) {
                    this.log.error(`Parse error ${e}`);
                }
            } else {
                this.log.error(`Cannot found raw data!`);
            }
        } else {
            this.log.error(`Cannot found last index!`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     */
    async createZigZag(id, sn) {
        //ToDo The angles were wrong.
        const angle_objs = await this.loadChannels(sn, "settings.multi_angle.0", true);
        const angles = Object.keys(angle_objs).length;
        if (angles == 4) {
            this.log.warn(`${sn} - Only 4 multi-angles can be created.`);
        }
        let isActive = false;
        let zigzag = [];
        for (const angle_obj of angle_objs) {
            const active = await this.getStateAsync(`${angle_obj._id}.active`);
            const angle = await this.getStateAsync(`${angle_obj._id}.angle`);
            if (active && active.val != null && angle && typeof angle.val === "number") {
                if (active.val) {
                    isActive = true;
                }
                const zz = {
                    active: active.val ? true : false,
                    angle: angle.val >= 0 && angle.val <= 180 ? angle.val : 90,
                };
                zigzag.push(zz);
            } else {
                this.log.warn(`Cannot found active and angle!`);
            }
        }
        const active = await this.getStateAsync(`${sn}.settings.multi_angle.angle_active`);
        const angle = await this.getStateAsync(`${sn}.settings.multi_angle.angle`);
        if (active && typeof active.val === "boolean" && angle && typeof angle.val === "number") {
            if (!isActive && !active.val) {
                active.val = true;
            }
            if (this.sunseeker) {
                const zz = {
                    active: active.val ? true : false,
                    angle: angle.val >= 0 && angle.val <= 180 ? angle.val : 90,
                };
                zigzag.push(zz);
                const status = await this.sunseeker.setPlanMode(sn, 4, zigzag);
                if (status) {
                    await this.setState(id, { val: false, ack: true });
                }
            }
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} state
     */
    async deleteCustomZigZag(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        const id_new = id.replace(".angle_create", "");
        const lastIndex = id_new.lastIndexOf(".");
        if (lastIndex !== -1) {
            const result = id_new.substring(0, lastIndex);
            const raw = await this.getStateAsync(`${result}.currentCustomRaw`);
            if (raw && typeof raw.val === "string" && raw.val.startsWith("{")) {
                try {
                    const json = JSON.parse(raw.val);
                    if (!json.multi_zigzag_angles) {
                        this.log.error(`Cannot found multi-angle`);
                        return;
                    }
                    let zigzag = [];
                    let count = 1;
                    for (const zag of json.multi_zigzag_angles) {
                        if (state != `0${count}`) {
                            zigzag.push(zag);
                        }
                    }
                    if (zigzag.length == 0) {
                        delete json.multi_zigzag_angles;
                        json.plan_mode = 0;
                    } else {
                        json.plan_mode = 4;
                        json.multi_zigzag_angles = zigzag;
                    }
                    this.sunseeker.setSettings(sn, json, "setCustom", "custom", null);
                    this.setState(id, { val: false, ack: true });
                } catch (e) {
                    this.log.error(`Parse error ${e}`);
                }
            } else {
                this.log.error(`Cannot found raw data`);
            }
        } else {
            this.log.error(`Cannot found last index!`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} state
     */
    async deleteZigZag(id, sn, state) {
        //ToDo The angles were wrong.
        const angle_objs = await this.loadChannels(sn, "settings.multi_angle.0", true);
        const angles = Object.keys(angle_objs).length;
        if (angles == 0) {
            this.log.warn(`${sn}: Please create/active a Multi-Angle under .settings.multi-angle!!!`);
            return;
        }
        let isActive = false;
        let zigzag = [];
        for (const angle_obj of angle_objs) {
            const active = await this.getStateAsync(`${angle_obj._id}.active`);
            const angle = await this.getStateAsync(`${angle_obj._id}.angle`);
            if (active && active.val != null && angle && typeof angle.val === "number") {
                if (active.val) {
                    isActive = true;
                }
                const lastsplit = angle_obj._id.split(".")[angle_obj._id.split(".").length - 1];
                this.log.debug(`${lastsplit} - ${state} - ${angle_obj._id} - ${angles}`);
                if (lastsplit != state) {
                    const zz = {
                        active: active.val ? true : false,
                        angle: angle.val >= 0 && angle.val <= 180 ? angle.val : 90,
                    };
                    zigzag.push(zz);
                }
            }
        }
        this.log.debug(JSON.stringify(zigzag));
        if (this.sunseeker) {
            if (angles > 0) {
                await this.delObjectAsync(`${this.namespace}.${sn}.settings.multi_angle.0${angles}`, {
                    recursive: true,
                });
            }
            let status = false;
            if (!isActive || zigzag.length == 0) {
                status = await this.sunseeker.setPlanMode(sn, 0, null);
            } else {
                status = await this.sunseeker.setPlanMode(sn, 4, zigzag);
            }
            if (status) {
                await this.setState(id, { val: "00", ack: true });
            }
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {number} state
     * @param {boolean} update
     */
    async sendZigZag(id, sn, state, update) {
        //ToDo Value 1 or 0 then disable all multi-angles
        //ToDo The angles were wrong.
        const angle_objs = await this.loadChannels(sn, "settings.multi_angle.0", true);
        const angles = Object.keys(angle_objs).length;
        if (angles == 0) {
            this.log.warn(`${sn}: Please create/active a Multi-Angle under .settings.multi-angle!!!`);
            return;
        }
        let isActive = false;
        let zigzag = [];
        for (const angle_obj of angle_objs) {
            const active = await this.getStateAsync(`${angle_obj._id}.active`);
            const angle = await this.getStateAsync(`${angle_obj._id}.angle`);
            if (active && active.val != null && angle && typeof angle.val === "number") {
                if (active.val) {
                    isActive = true;
                }
                const zz = {
                    active: active.val ? true : false,
                    angle: angle.val >= 0 && angle.val <= 180 ? angle.val : 90,
                };
                zigzag.push(zz);
            }
        }
        if (!isActive && !update) {
            this.log.warn(`${sn}: Please active a Multi-Angle under .settings.multi-angle!!!`);
            return;
        }
        if (this.sunseeker) {
            let status = false;
            if (!isActive) {
                status = await this.sunseeker.setPlanMode(sn, 0, null);
            } else {
                status = await this.sunseeker.setPlanMode(sn, state, zigzag);
            }
            if (status) {
                await this.setState(id, { val: state, ack: true });
            }
        }
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async setNotice(sn, data) {
        if (this.sunseeker) {
            await this.sunseeker.setNotice(sn, data);
            await this.sunseeker.getNotice(sn);
        }
    }

    /**
     * @param {string} sn
     */
    updateDeviceAfterStateChange(sn) {
        this.log.debug(`Update device: ${sn}`);
        this.updateDeviceStateChange = this.setTimeout(() => {
            this.updateDeviceStateChange = null;
            this.sunseeker?.updateDevice(sn).catch(() => {});
        }, 1500);
    }
    /**
     * @param {string} id
     * @param {string} sn
     * @param {string | undefined | null} state
     */
    async startMowingSelectedArea(id, sn, state) {
        if (state && state.startsWith("[")) {
            try {
                const areas = JSON.parse(state);
                const lastIndex = id.lastIndexOf(".");
                if (lastIndex !== -1) {
                    const result = id.substring(0, lastIndex);
                    const area_id = await this.getStateAsync(`${result}.id`);
                    if (area_id && typeof area_id.val === "number") {
                        if (this.sunseeker) {
                            const val = {
                                area_info: [
                                    {
                                        map_id: area_id.val,
                                        vertexs: areas,
                                    },
                                ],
                            };
                            await this.sunseeker.setSettings(sn, null, "setDivideArea", "divide_area", val);
                            this.updateDeviceAfterStateChange(sn);
                            this.setState(id, { val: JSON.stringify([]), ack: true });
                        }
                        return;
                    }
                    this.log.warn(`Wrong Id path - ${JSON.stringify(result)}`);
                    return;
                }
                this.log.warn(`Wrong Id - ${id}`);
                return;
            } catch (e) {
                this.log.error(`Error area ${e}`);
                return;
            }
        }
        this.log.warn(`Wrong format!`);
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} command
     * @param {string} path
     * @param {ioBroker.State | null | undefined} state
     */
    async splitWorkArea(id, sn, command, path, state) {
        if (state && typeof state.val === "string" && state.val.startsWith("[")) {
            try {
                const areas = JSON.parse(state.val);
                const area_id = await this.getStateAsync(`${path}.id`);
                if (area_id && typeof area_id.val === "number") {
                    if (this.sunseeker) {
                        const val = {
                            points: areas,
                            region: area_id.val,
                        };
                        await this.sunseeker.sendCommand(sn, command, val);
                        this.updateDeviceAfterStateChange(sn);
                        this.setState(id, { val: JSON.stringify([]), ack: true });
                    }
                    return;
                }
                this.log.warn(`Wrong Id path - ${JSON.stringify(path)}`);
                return;
            } catch (e) {
                this.log.error(`Error area merge ${e}`);
                return;
            }
        }
        this.log.warn(`Wrong format!`);
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} command
     * @param {ioBroker.State | null | undefined} state
     */
    async mergeWorkArea(id, sn, command, state) {
        if (state && typeof state.val === "string" && state.val.startsWith("[")) {
            try {
                const areas = JSON.parse(state.val);
                const merge_areas = [];
                if (Array.isArray(areas) && areas.length > 1 && areas.length < 5) {
                    for (const area of areas) {
                        const area_id = await this.getStateAsync(`${sn}.map.zones.0${area}.id`);
                        if (area_id && typeof area_id.val === "number") {
                            merge_areas.push(area_id.val);
                        } else {
                            this.log.warn(`Wrong Id - ${JSON.stringify(area)}`);
                        }
                    }
                    if (merge_areas.length > 1) {
                        if (this.sunseeker) {
                            await this.sunseeker.sendCommand(sn, command, merge_areas);
                            this.updateDeviceAfterStateChange(sn);
                        }
                        this.setState(id, { val: JSON.stringify([]), ack: true });
                        return;
                    }
                    this.log.warn(`At least two areas must be specified - ${JSON.stringify(merge_areas)}`);
                    return;
                }
                this.log.warn(`Wrong area format! - ${JSON.stringify(areas)}`);
                return;
            } catch (e) {
                this.log.error(`Error area merge ${e}`);
                return;
            }
        }
        this.log.warn(`Wrong format!`);
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async onSunseekerInviteCheck(sn, data) {
        if (!this.sunseeker) {
            return;
        }
        if (data && data.data && data.deviceSn && data.data.body) {
            const states = {
                none: "none",
            };
            states[data.deviceSn] = `${data.data.body}<time>${data.timestamp}`;
            this.sunseeker.updateShareApplyInvite(sn, states, true);
        } else {
            this.log.warn(`Attributes are missing from the invitation - ${JSON.stringify(data)}`);
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} state
     */
    async setTopUpArrayAndCheck(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        let all_sn = [];
        try {
            all_sn = JSON.parse(state);
        } catch (e) {
            this.log.error(`topUp array: ${state} - ${e}`);
        }
        if (all_sn.length == 0) {
            this.log.error(`The device array is empty`);
            return;
        }
        const raws = this.sunseeker.devicesRaw;
        if (Object.keys(raws).length != all_sn.length) {
            this.log.error(`The serial number does not match. ${Object.keys(raws).length} - ${all_sn.length}`);
            return;
        }
        for (const single_sn of all_sn) {
            let sn = "";
            try {
                sn = single_sn.replace(this.FORBIDDEN_CHARS, "_");
            } catch (e) {
                this.log.error(`Serial number ${sn} has an incorrect format. - ${e}`);
                return;
            }
            if (!raws[sn]) {
                this.log.error(`Serial number ${sn} not found`);
                return;
            }
        }
        const status = await this.sunseeker.setTopUp(id, sn, all_sn, 2);
        if (status) {
            this.delay(2000);
            this.sunseeker.getUpdateDevices();
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {boolean} state
     */
    async setTopUpAndCheck(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        if (!state) {
            this.log.info(`One can only activate.`);
            return;
        }
        const metas = this.sunseeker.deviceMeta;
        const raws = this.sunseeker.devicesRaw;
        const snList = [];
        snList.push(sn);
        if (Object.keys(raws).length < 2) {
            this.log.warn(`Only one device found.`);
            return;
        }
        for (const raw of Object.values(raws)) {
            const meta = metas[raw.deviceSn];
            if (meta.topUp) {
                if (raw.deviceSn == sn) {
                    this.log.info(`Device ${sn} is already activated for the home page.`);
                    return;
                }
            }
            if (raw.deviceSn != sn) {
                snList.push(raw.deviceSn);
            }
        }
        const status = await this.sunseeker.setTopUp(id, sn, snList, 1);
        if (status) {
            this.delay(2000);
            this.sunseeker.getUpdateDevices();
        }
    }

    /**
     * @param {string} id
     * @param {string} sn
     * @param {ioBroker.State} state
     */
    async shareCommand(id, sn, state) {
        if (!this.sunseeker) {
            return;
        }
        const parts = id.split(".");
        const command = parts.pop();
        const objId = parts.join(".");
        if (command === "alias") {
            const deviceId = await this.getStateAsync(`${objId}.deviceUser.deviceId`);
            const ownerAppUserId = await this.getStateAsync(`${objId}.deviceUser.appUserId`);
            if (deviceId && deviceId.val && ownerAppUserId && ownerAppUserId.val) {
                const data = {
                    deviceId: deviceId.val,
                    remark: state.val,
                    userId: ownerAppUserId.val,
                };
                const status = await this.sunseeker.setRemark(id, sn, data);
                if (status) {
                    this.updateDeviceAfterStateChange(sn);
                }
            } else {
                this.log.warn(`Cannot found user data ${objId}.deviceUser.deviceId - ${objId}.deviceUser.appUserId`);
            }
        } else if (command === "select_device_delete") {
            if (!this.sunseeker) {
                return;
            }
            const deviceId = await this.getStateAsync(`${objId}.select_device`);
            if (deviceId && deviceId.val && typeof deviceId.val === "string" && deviceId.val != "none") {
                const raw = this.sunseeker.devicesId[deviceId.val];
                if (!raw) {
                    this.log.error(`Cannot found device ${deviceId.val}`);
                    return;
                }
                if (!this.sunseeker.devicesRaw[raw]) {
                    this.log.error(`Cannot found device ${deviceId.val}`);
                    return;
                }
                const delObj = await this.getObjectAsync(`${objId}.select_device`);
                if (!delObj) {
                    this.log.error(`Cannot found object ${objId}.select_device`);
                    return;
                }
                delete delObj.common.states[deviceId.val];
                const new_obj = JSON.parse(JSON.stringify(delObj));
                const status = await this.sunseeker.deleteDevice(
                    id,
                    sn,
                    deviceId.val,
                    raw,
                    new_obj,
                    `${objId}.select_device`,
                );
                if (status) {
                    this.restart();
                }
            }
        } else if (command === "share_send") {
            const mail = await this.getStateAsync(`${objId}.share_email`);
            if (mail && mail.val && typeof mail.val === "string" && this.isValidSyntax(mail.val)) {
                const status = await this.sunseeker.sendShareRequest(id, objId, sn, mail.val);
                if (status) {
                    this.updateDeviceAfterStateChange(sn);
                }
            } else {
                this.log.warn(`Cannot found user data ${objId}.share_email`);
            }
        } else if (command === "revoke") {
            const mark = await this.getStateAsync(`${objId}.mark_revoke`);
            const deviceId = await this.getStateAsync(`${objId}.deviceUser.deviceId`);
            const ownerAppUserId = await this.getStateAsync(`${objId}.deviceUser.appUserId`);
            if (deviceId && deviceId.val && typeof deviceId.val === "string" && ownerAppUserId && ownerAppUserId.val) {
                const data = {
                    deviceId: deviceId.val,
                    userId: ownerAppUserId.val,
                };
                if (state && typeof state.val === "boolean" && state.val) {
                    if (mark && typeof mark.val === "boolean" && mark.val) {
                        const status = await this.sunseeker.setUnbind(sn, data, objId);
                        if (status) {
                            this.updateDeviceAfterStateChange(sn);
                        }
                    } else {
                        this.log.warn(`Please confirm the deletion - ${state.val}`);
                    }
                }
            } else {
                this.log.warn(
                    `Cannot found user data ${objId}.share_user.${state.val}.deviceUser.deviceId - ${objId}.share_user.${state.val}.deviceUser.appUserId`,
                );
            }
        } else if (command === "share_apply_invite") {
            if (state && state.val && state.val != "none") {
                const data = {
                    deviceSn: state.val,
                    accept: 1,
                };
                if (state && state.val && typeof state.val === "string") {
                    const obj = await this.getObjectAsync(id);
                    if (obj && obj.common && obj.common.states) {
                        delete obj.common.states[state.val];
                        const new_obj = JSON.parse(JSON.stringify(obj));
                        const status = await this.sunseeker.acceptShareApplyInvite(id, "none", new_obj, sn, data);
                        if (status) {
                            this.restart();
                        }
                    }
                }
            }
        }
    }

    /**
     * @param {string} sn
     * @param {any} data
     * @param {number} plan
     */
    async cleanUpCalendar(sn, data, plan) {
        this.log.debug(`cleanUpCalendar: ${plan} - ${JSON.stringify(data)}`);
        const day_channel = {
            1: "1_monday",
            2: "2_tuesday",
            3: "3_wednesday",
            4: "4_thursday",
            5: "5_friday",
            6: "6_saturday",
            0: "0_sunday",
        };
        const schedule = { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
        const schedule_empty = { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
        const schedule_empty2 = { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
        const mower_schedule = plan == 1 ? data.time : data.time_custom;
        if (typeof mower_schedule === "object" && mower_schedule !== null) {
            if (!Array.isArray(mower_schedule)) {
                return;
            }
            for (const d of mower_schedule) {
                if (Object.keys(d).length < 4 || d.period == null) {
                    return;
                }
                const day = d.period[0];
                if (day === null) {
                    this.log.debug(`Schedule is null!`);
                    return;
                }
                const mower_time_start = this.getTimeString(d.start);
                const mower_time_end = this.getTimeString(d.end);
                let path_start = `${sn}.schedule.${day_channel[day]}_1.start`;
                let path_end = `${sn}.schedule.${day_channel[day]}_1.end`;
                let path = `${sn}.schedule.${day_channel[day]}_1`;
                if (!schedule[day]) {
                    schedule[day] = true;
                    schedule_empty[day] = true;
                } else {
                    path_start = `${sn}.schedule.${day_channel[day]}_2.start`;
                    path_end = `${sn}.schedule.${day_channel[day]}_2.end`;
                    schedule_empty2[day] = true;
                    path = `${sn}.schedule.${day_channel[day]}_2`;
                }
                await this.setState(path_start, { val: mower_time_start, ack: true });
                await this.setState(path_end, { val: mower_time_end, ack: true });
                await this.setScheduleData(path, d);
            }
        }
        if (typeof data.pause === "boolean") {
            await this.setState(`${sn}.schedule.pauseSchedule`, { val: data.pause, ack: true });
        }
        for (const d in schedule_empty) {
            if (!schedule_empty[d]) {
                await this.setState(`${sn}.schedule.${day_channel[d]}_1.start`, { val: "", ack: true });
                await this.setState(`${sn}.schedule.${day_channel[d]}_1.end`, { val: "", ack: true });
            }
        }
        if (this.sunseeker) {
            const meta = this.sunseeker.deviceMeta[sn];
            if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                for (const d in schedule_empty2) {
                    if (!schedule_empty2[d]) {
                        await this.setState(`${sn}.schedule.${day_channel[d]}_2.start`, {
                            val: "",
                            ack: true,
                        });
                        await this.setState(`${sn}.schedule.${day_channel[d]}_2.end`, {
                            val: "",
                            ack: true,
                        });
                    }
                }
            }
        }
    }

    /**
     * @param {number} start
     * @returns {string} hh:mm
     */
    getTimeString(start) {
        const utcStart = new Date(start * 1000);
        return `${`0${utcStart.getUTCHours()}`.slice(-2)}:${`0${utcStart.getUTCMinutes()}`.slice(-2)}`;
    }

    /**
     * @param {string} path
     * @param {any} data
     */
    async setScheduleData(path, data) {
        if (typeof data.active === "boolean") {
            await this.setState(`${path}.active`, { val: data.active, ack: true });
        }
        if (typeof data.region_id === "object") {
            await this.setState(`${path}.zones`, { val: JSON.stringify(data.region_id), ack: true });
        }
        if (typeof data.unlock === "boolean") {
            await this.setState(`${path}.unlock`, { val: data.unlock, ack: true });
        }
        if (typeof data.need_fllow_boader === "boolean") {
            await this.setState(`${path}.need_follow_border`, { val: data.need_fllow_boader, ack: true });
        }
        if (typeof data.work_order === "number") {
            await this.setState(`${path}.work_order`, { val: data.work_order, ack: true });
        }
    }

    /**
     * @param {string} sn
     */
    async collectSchedulePlan(sn) {
        if (!this.sunseeker) {
            return;
        }
        const meta = this.sunseeker.deviceMeta[sn];
        const days = [1, 2, 3, 4, 5, 6, 0];
        const day_channel = {
            1: "1_monday",
            2: "2_tuesday",
            3: "3_wednesday",
            4: "4_thursday",
            5: "5_friday",
            6: "6_saturday",
            0: "0_sunday",
        };
        const plan = {};
        const plan2 = {};
        try {
            for (const day of days) {
                plan[day_channel[day]] = {};
                await this.getScheduleData(sn, plan, day_channel[day], 1);
                if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                    plan2[day_channel[day]] = {};
                    await this.getScheduleData(sn, plan2, day_channel[day], 2);
                }
            }
            const pauseSt = await this.getStateAsync(`${sn}.schedule.pauseSchedule`);
            plan.pause = !!(pauseSt && pauseSt.val);
            this.log.debug(`collectSchedulePlan 1: ${JSON.stringify(plan)}`);
            this.log.debug(`collectSchedulePlan 2: ${JSON.stringify(plan2)}`);
            await this.sunseeker.setSchedule(sn, plan, plan2);
            this.updateDeviceSet = this.setTimeout(() => this.sunseeker?.updateDevice(sn).catch(() => {}), 1500);
        } catch (err) {
            this.log.error(`Schedule for ${sn} failed: ${err.message}`);
        }
    }

    async getScheduleData(sn, plan, schedule, d_time) {
        const st = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.start`);
        const ste = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.end`);
        if (st && st.val && st.val != "" && ste && ste.val && ste.val != "") {
            plan[schedule].time = `${String(st.val)}-${String(ste.val)}`;
        } else {
            plan[schedule].time = "";
        }
        const ul = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.unlock`);
        if (ul && typeof ul.val === "boolean") {
            plan[schedule].unlock = ul.val;
        } else {
            plan[schedule].unlock = true;
        }
        const zs = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.zones`);
        if (zs && typeof zs.val === "string" && zs.val.startsWith("[")) {
            plan[schedule].zone = JSON.parse(zs.val);
        } else {
            plan[schedule].zone = [];
        }
        const ac = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.active`);
        if (ac && typeof ac.val === "boolean") {
            plan[schedule].active = ac.val;
        } else {
            plan[schedule].active = true;
        }
        const wo = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.work_order`);
        if (wo && typeof wo.val === "number") {
            plan[schedule].order = wo.val;
        } else {
            plan[schedule].order = 0;
        }
        const fb = await this.getStateAsync(`${sn}.schedule.${schedule}_${d_time}.need_follow_border`);
        if (fb && typeof fb.val === "boolean") {
            plan[schedule].border = fb.val;
        } else {
            plan[schedule].border = false;
        }
    }

    /**
     * @param {any} obj
     */
    removeNull(obj) {
        if (typeof obj.rainDelayDuration === "string") {
            obj.rainDelayDuration = parseInt(obj.rainDelayDuration);
        }
        return JSON.parse(JSON.stringify(obj), (key, value) => {
            if (value === null) {
                return undefined;
            }
            return value;
        });
    }

    /**
     * @param {string} sn
     * @param {string} path
     * @param {boolean} select
     */
    async loadChannels(sn, path, select) {
        const obj = await this.getChannelsAsync();
        if (select) {
            return obj.filter(m => m._id.includes(`${this.namespace}.${sn}.${path}`));
        }
        return obj.filter(
            m =>
                m._id == `${this.namespace}.${sn}.${path}1` ||
                m._id == `${this.namespace}.${sn}.${path}2` ||
                m._id == `${this.namespace}.${sn}.${path}3` ||
                m._id == `${this.namespace}.${sn}.${path}4`,
        );
    }

    /**
     * @param {string} sn
     * @param {any} maps
     */
    async updateMaps(sn, maps) {
        const map_new = Object.keys(maps).length;
        if (!this.availableMaps) {
            this.availableMaps = await this.loadChannels(sn, "map.maps.0", true);
        }
        const map_obj = this.availableMaps;
        const map_old = Object.keys(map_obj).length;
        if (map_old > map_new) {
            let count = map_old;
            let save = 0;
            for (let a = map_new; a <= map_old - 1; a++) {
                this.log.info(`delete zone: ${this.namespace}.${sn}.map.maps.0${count}`);
                await this.delObjectAsync(`${this.namespace}.${sn}.map.maps.0${count}`, {
                    recursive: true,
                });
                this.json2iob.resetCache(`${sn}.map.maps.0${count}`);
                --count;
                ++save;
                if (save > 10) {
                    break;
                }
            }
            this.availableMaps = await this.loadChannels(sn, "map.maps.0", true);
        }
        await this.json2iob.parse(`${sn}.map.maps`, maps, {
            channelName: {
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
                icon: "img/map.png",
                desc: "Create by Adapter",
            },
            forceIndex: true,
            roles: {
                mapUrl: "text.url",
                thumbnailUrl: "text.url",
                mapId: "value",
            },
        });
        let common;
        let path = "";
        let count = 1;
        let used = false;
        let mapName = "";
        for (const map of maps) {
            if (map.used) {
                used = true;
                mapName = map.mapName;
            }
            path = `${sn}.map.maps.0${count}`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: map.mapName,
                    desc: "Create by Adapter",
                    icon: "img/map.png",
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "channel", null, null, null);
            }
            if (!used) {
                path = `${sn}.map.maps.0${count}.useThisMap`;
                if (!this.createObjectDone[path] && this.sunseeker) {
                    this.createObjectDone[path] = true;
                    common = {
                        name: {
                            en: "Use map",
                            de: "Karte verwenden",
                            ru: "Используйте карту",
                            pt: "Use o mapa",
                            nl: "Gebruik de kaart",
                            fr: "Utiliser la carte",
                            it: "Utilizzare la mappa",
                            es: "Utilice el mapa",
                            pl: "Użyj mapy",
                            uk: "Використати карту",
                            "zh-cn": "使用地图",
                        },
                        desc: "Create by Adapter",
                        type: "boolean",
                        role: "button",
                        read: false,
                        write: true,
                        def: false,
                    };
                    await this.sunseeker.createDataPoint(
                        `${this.namespace}.${path}`,
                        common,
                        "state",
                        null,
                        null,
                        null,
                    );
                }
            } else {
                await this.delObjectAsync(`${this.namespace}.${sn}.map.maps.0${count}.useThisMap`, {
                    recursive: true,
                });
            }
            path = `${sn}.map.maps.0${count}.delete`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "Map backup delete finally",
                        de: "Kartensicherung endgültig löschen",
                        ru: "Наконец-то удалена резервная копия карты.",
                        pt: "Excluir definitivamente o backup do mapa",
                        nl: "Kaartback-up definitief verwijderen",
                        fr: "Suppression définitive de la sauvegarde de la carte",
                        it: "Eliminazione definitiva del backup della mappa",
                        es: "Eliminar finalmente la copia de seguridad del mapa",
                        pl: "Kopia zapasowa mapy została ostatecznie usunięta",
                        uk: "Резервна копія карти остаточно видалена",
                        "zh-cn": "地图备份最终删除",
                    },
                    desc: "Create by Adapter",
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false,
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
                common = {
                    name: {
                        en: "Set to True to delete. Then press the delete button",
                        de: "Auf „Wahr“ stellen, um zu löschen. Anschließend die Löschtaste drücken.",
                        ru: "Установите значение «Истина», чтобы удалить. Затем нажмите кнопку «Удалить».",
                        pt: "Defina como Verdadeiro para excluir. Em seguida, pressione o botão Excluir.",
                        nl: "Zet de optie op 'True' om te verwijderen. Druk vervolgens op de verwijderknop.",
                        fr: "Cochez la case « Vrai » pour supprimer. Appuyez ensuite sur le bouton Supprimer.",
                        it: "Imposta su True per eliminare. Quindi premi il pulsante Elimina.",
                        es: "Establézcalo en Verdadero para eliminar. Luego presione el botón Eliminar.",
                        pl: "Ustaw na Prawda, aby usunąć. Następnie naciśnij przycisk Usuń.",
                        uk: "Встановіть значення True для видалення. Потім натисніть кнопку видалення",
                        "zh-cn": "设置为“是”以删除。然后按删除按钮。",
                    },
                    desc: "Create by Adapter",
                    type: "boolean",
                    role: "switch",
                    read: true,
                    write: true,
                    def: false,
                };
                await this.sunseeker.createDataPoint(
                    `${this.namespace}.${sn}.map.maps.0${count}.delete_select`,
                    common,
                    "state",
                    null,
                    null,
                    null,
                );
            }
            path = `${sn}.map.maps.0${count}.mapName`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "Change map name",
                        de: "Kartennamen ändern",
                        ru: "Изменить название карты",
                        pt: "Alterar nome do mapa",
                        nl: "Kaartnaam wijzigen",
                        fr: "Changer le nom de la carte",
                        it: "Cambia il nome della mappa",
                        es: "Cambiar nombre del mapa",
                        pl: "Zmień nazwę mapy",
                        uk: "Змінити назву карти",
                        "zh-cn": "更改地图名称",
                    },
                    desc: "Create by Adapter",
                    type: "string",
                    role: "state",
                    read: true,
                    write: true,
                    def: "",
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
            }
            ++count;
        }
        if (used && map_new < 5) {
            path = `${sn}.map.zones.save_active_map`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}`, {
                    type: "state",
                    common: {
                        name: {
                            en: "Save active map",
                            de: "Aktive Karte speichern",
                            ru: "Сохранить активную карту",
                            pt: "Salvar mapa ativo",
                            nl: "Actieve kaart opslaan",
                            fr: "Sauvegarder la carte active",
                            it: "Salva la mappa attiva",
                            es: "Guardar mapa activo",
                            pl: "Zapisz aktywną mapę",
                            uk: "Зберегти активну карту",
                            "zh-cn": "保存当前地图",
                        },
                        desc: "Create by Adapter",
                        type: "boolean",
                        role: "button",
                        write: true,
                        read: false,
                        def: false,
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`save_active_map: ${error.name}: ${error.message}`);
                });
            }
        } else {
            await this.delObjectAsync(`${this.namespace}.${sn}.map.zones.save_active_map`, {
                recursive: true,
            });
        }
        if (map_new > 0) {
            path = `${sn}.map.zones.delete_active_map`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}`, {
                    type: "state",
                    common: {
                        name: {
                            en: "Delete active map",
                            de: "Aktive Karte löschen",
                            ru: "Удалить активную карту",
                            pt: "Excluir mapa ativo",
                            nl: "Actieve kaart verwijderen",
                            fr: "Supprimer la carte active",
                            it: "Elimina la mappa attiva",
                            es: "Eliminar mapa activo",
                            pl: "Usuń aktywną mapę",
                            uk: "Видалити активну карту",
                            "zh-cn": "删除活动地图",
                        },
                        desc: "Create by Adapter",
                        type: "boolean",
                        role: "button",
                        write: true,
                        read: false,
                        def: false,
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`delete_active_map: ${error.name}: ${error.message}`);
                });
            }
            path = `${sn}.map.zones.delete_active_map_select`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}`, {
                    type: "state",
                    common: {
                        name: {
                            en: "Mark active map for deletion",
                            de: "Aktive Karte zum Löschen markieren",
                            ru: "Отметьте активную карту для удаления",
                            pt: "Marcar mapa ativo para exclusão",
                            nl: "Markeer actieve kaart voor verwijdering",
                            fr: "Marquer la carte active pour suppression",
                            it: "Contrassegna la mappa attiva per la cancellazione",
                            es: "Marcar mapa activo para su eliminación",
                            pl: "Oznacz aktywną mapę do usunięcia",
                            uk: "Позначити активну карту для видалення",
                            "zh-cn": "标记活动地图以进行删除",
                        },
                        desc: "Create by Adapter",
                        type: "boolean",
                        role: "switch",
                        write: true,
                        read: true,
                        def: false,
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`delete_active_map_select: ${error.name}: ${error.message}`);
                });
            }
            path = `${sn}.map.zones.change_active_map_name`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                await this.setObjectNotExistsAsync(`${this.namespace}.${path}`, {
                    type: "state",
                    common: {
                        name: {
                            en: "Change active map name",
                            de: "Aktiven Kartennamen ändern",
                            ru: "Изменить название активной карты",
                            pt: "Alterar o nome do mapa ativo",
                            nl: "Wijzig de actieve kaartnaam",
                            fr: "Modifier le nom de la carte active",
                            it: "Cambia il nome della mappa attiva",
                            es: "Cambiar el nombre del mapa activo",
                            pl: "Zmień nazwę aktywnej mapy",
                            uk: "Змінити назву активної карти",
                            "zh-cn": "更改活动地图名称",
                        },
                        desc: "Create by Adapter",
                        type: "string",
                        role: "state",
                        write: true,
                        read: true,
                        def: "",
                    },
                    native: {},
                }).catch(error => {
                    this.log.error(`change_active_map_name: ${error.name}: ${error.message}`);
                });
                if (mapName != "") {
                    this.setSettings(sn, { map_temp_name: mapName });
                } else {
                    this.sunseeker.getMapTempName(sn);
                }
            }
        } else {
            await this.delObjectAsync(`${this.namespace}.${sn}.map.zones.delete_active_map`, {
                recursive: true,
            });
            await this.delObjectAsync(`${this.namespace}.${sn}.map.zones.delete_active_map_select`, {
                recursive: true,
            });
            await this.delObjectAsync(`${this.namespace}.${sn}.map.zones.change_active_map_name`, {
                recursive: true,
            });
        }
    }

    /**
     * @param {string} sn
     * @param {Record<string, any>} settingsData
     */
    async ensureWritableSettings(sn, settingsData) {
        if (!settingsData) {
            return;
        }
        let path = "";
        let common;
        if (this.config.apptype !== "Old") {
            if (Object.prototype.hasOwnProperty.call(settingsData, "bladeSpeed")) {
                path = `${sn}.settings.bladeSpeed`;
                if (!this.createObjectDone[path] && this.sunseeker) {
                    this.createObjectDone[path] = true;
                    common = {
                        name: {
                            en: "Blade speed",
                            de: "Klingengeschwindigkeit",
                            ru: "Скорость лезвия",
                            pt: "Velocidade da lâmina",
                            nl: "Bladsnelheid",
                            fr: "vitesse de la lame",
                            it: "velocità della lama",
                            es: "Velocidad de la hoja",
                            pl: "Prędkość ostrza",
                            uk: "Швидкість леза",
                            "zh-cn": "刀刃速度",
                        },
                        desc: "Create by Adapter",
                        type: "number",
                        role: "level",
                        min: 2800,
                        max: 3000,
                        step: 100,
                        unit: "rpm",
                        read: true,
                        write: true,
                    };
                    await this.sunseeker.createDataPoint(
                        `${this.namespace}.${path}`,
                        common,
                        "state",
                        null,
                        null,
                        null,
                    );
                }
            }
            if (Object.prototype.hasOwnProperty.call(settingsData, "bladeHeight")) {
                path = `${sn}.settings.bladeHeight`;
                if (!this.createObjectDone[path] && this.sunseeker) {
                    this.createObjectDone[path] = true;
                    common = {
                        name: {
                            en: "Cutting height",
                            de: "Schnitthöhe",
                            ru: "Высота среза",
                            pt: "Altura de corte",
                            nl: "Snijhoogte",
                            fr: "Hauteur de coupe",
                            it: "altezza di taglio",
                            es: "Altura de corte",
                            pl: "Wysokość koszenia",
                            uk: "Висота зрізання",
                            "zh-cn": "切割高度",
                        },
                        desc: "Create by Adapter",
                        type: "number",
                        role: "level",
                        min: 20,
                        max: 100,
                        step: 5,
                        unit: "mm",
                        read: true,
                        write: true,
                    };
                    await this.sunseeker.createDataPoint(
                        `${this.namespace}.${path}`,
                        common,
                        "state",
                        null,
                        null,
                        null,
                    );
                }
            }
        }
        if (Object.prototype.hasOwnProperty.call(settingsData, "rainFlag")) {
            path = `${sn}.settings.rainFlag`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "Pause during rain",
                        de: "Pause bei Regen",
                        ru: "Пауза во время дождя",
                        pt: "Pausa durante a chuva",
                        nl: "Pauzeer tijdens regen",
                        fr: "Pause pendant la pluie",
                        it: "Pausa durante la pioggia",
                        es: "Pausa durante la lluvia",
                        pl: "Pauza podczas deszczu",
                        uk: "Пауза під час дощу",
                        "zh-cn": "雨中暂停",
                    },
                    desc: "Create by Adapter",
                    type: "boolean",
                    role: "switch",
                    read: true,
                    write: true,
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
            }
        }
        if (Object.prototype.hasOwnProperty.call(settingsData, "rainDelayDuration")) {
            path = `${sn}.settings.rainDelayDuration`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    name: {
                        en: "Rain Delay Duration",
                        de: "Regenverzögerungsdauer",
                        ru: "Продолжительность задержки из-за дождя",
                        pt: "Duração do atraso devido à chuva",
                        nl: "Duur van de regenvertraging",
                        fr: "Durée du retard dû à la pluie",
                        it: "Durata del ritardo dovuto alla pioggia",
                        es: "Duración del retraso por lluvia",
                        pl: "Czas trwania opóźnienia z powodu deszczu",
                        uk: "Тривалість затримки через дощ",
                        "zh-cn": "雨天延误时长",
                    },
                    desc: "Create by Adapter",
                    type: "number",
                    role: "level",
                    min: 0,
                    max: 720,
                    step: 1,
                    unit: "min",
                    read: true,
                    write: true,
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
            }
        }
    }

    /**
     * @param {any} data
     */
    async onSunseekerAppInfo(data) {
        if (typeof data.isoCode === "string" && this.createObjectDone[`profile.country.country`]) {
            await this.setState(`profile.country.country`, { val: data.isoCode, ack: true });
        }
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async onSunseekerDeviceSettingsState(sn, data) {
        this.log.debug(`SettingsState: ${JSON.stringify(data)}`);
        await this.setSettings(sn, data);
        //await this.setMowerRaw(sn, data);
    }

    /**
     * @param {string} sn
     * @param {any} data
     */
    async setSettings(sn, data) {
        if (data && this.sunseeker) {
            await this.sunseeker.setStates(sn, data, this.createObjectDone);
        }
    }

    getWeek() {
        const target = new Date();
        const getDay = target.getDay();
        const dayNr = (target.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const jan4 = new Date(target.getFullYear(), 0, 4);
        const dayDiff = (target.getTime() - jan4.getTime()) / 86400000;
        if (new Date(target.getFullYear(), 0, 1).getDay() < 5) {
            return `${1 + Math.ceil(dayDiff / 7)}-${getDay}`;
        }
        return `${Math.ceil(dayDiff / 7)}-${getDay}`;
    }

    async createAuth() {
        if (this.sunseeker) {
            let common;
            common = {
                name: {
                    en: "Auth Information",
                    de: "Authentifizierungsinformationen",
                    ru: "Информация об аутентификации",
                    pt: "Informações de autorização",
                    nl: "Autorisatie-informatie",
                    fr: "Informations d'autorisation",
                    it: "Informazioni di autorizzazione",
                    es: "Información de autorización",
                    pl: "Informacje o uwierzytelnianiu",
                    uk: "Інформація для авторизації",
                    "zh-cn": "授权信息",
                },
                desc: "Create by Adapter",
                icon: "img/auth.png",
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.auth`, common, "channel", null, null, null);
            common = {
                name: {
                    en: "Rate Limit",
                    de: "Ratenbegrenzung",
                    ru: "Лимит скорости",
                    pt: "Limite de taxa",
                    nl: "Snelheidslimiet",
                    fr: "Limite de débit",
                    it: "Limite di tariffa",
                    es: "Límite de tasa",
                    pl: "Limit szybkości",
                    uk: "Ліміт швидкості",
                    "zh-cn": "速率限制",
                },
                desc: "Create by Adapter",
                icon: "img/rate.png",
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.rateLimit`, common, "channel", null, null, null);
            common = {
                name: {
                    en: "Session",
                    de: "Sitzung",
                    ru: "Сессия",
                    pt: "Sessão",
                    nl: "Sessie",
                    fr: "Session",
                    it: "Sessione",
                    es: "Sesión",
                    pl: "Sesja",
                    uk: "Сесія",
                    "zh-cn": "会议",
                },
                type: "string",
                role: "json",
                desc: "Create by Adapter",
                read: true,
                write: false,
                def: JSON.stringify({}),
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.auth.session`, common, "state", null, null, null);
            common = {
                name: {
                    en: "Mqtt connection",
                    de: "MQTT-Verbindung",
                    ru: "MQTT-соединение",
                    pt: "Conexão MQTT",
                    nl: "MQTT-verbinding",
                    fr: "Connexion MQTT",
                    it: "Connessione MQTT",
                    es: "conexión MQTT",
                    pl: "Połączenie MQTT",
                    uk: "З'єднання Mqtt",
                    "zh-cn": "MQTT 连接",
                },
                type: "string",
                role: "json",
                desc: "Create by Adapter",
                read: true,
                write: false,
                def: JSON.stringify({}),
            };
            await this.sunseeker.createDataPoint(
                `${this.namespace}.auth.mqtt_connection`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "App id (device id for MQTT)",
                    de: "App-ID (Geräte-ID für MQTT)",
                    ru: "Идентификатор приложения (ID устройства для MQTT)",
                    pt: "ID do aplicativo (ID do dispositivo para MQTT)",
                    nl: "App-id (apparaat-id voor MQTT)",
                    fr: "ID de l'application (ID d'appareil pour MQTT)",
                    it: "ID app (ID dispositivo per MQTT)",
                    es: "ID de app (ID de dispositivo para MQTT)",
                    pl: "Identyfikator aplikacji (ID urządzenia dla MQTT)",
                    uk: "Ідентифікатор програми (ID пристрою для MQTT)",
                    "zh-cn": "应用 ID（MQTT 设备 ID）",
                },
                type: "string",
                role: "text",
                desc: "Delete and restart the adapter to generate a new one",
                read: true,
                write: false,
                def: "",
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.auth.app_id`, common, "state", null, null, null);
            common = {
                name: {
                    en: "Restart Limit",
                    de: "Neustartlimit",
                    ru: "Ограничение перезапуска",
                    pt: "Limite de reinicialização",
                    nl: "Herstartlimiet",
                    fr: "Limite de redémarrage",
                    it: "Limite di riavvio",
                    es: "Límite de reinicio",
                    pl: "Limit ponownego uruchomienia",
                    uk: "Ліміт перезапуску",
                    "zh-cn": "重启限制",
                },
                type: "string",
                role: "json",
                desc: "Create by Adapter",
                read: true,
                write: false,
                def: JSON.stringify({
                    restartCount: 0,
                    restartLast: 0,
                    restartTime: "",
                    day: "",
                }),
            };
            await this.sunseeker.createDataPoint(
                `${this.namespace}.rateLimit.restart`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "HTTPS Request Limit",
                    de: "HTTPS-Anfragelimit",
                    ru: "Ограничение на количество HTTPS-запросов",
                    pt: "Limite de solicitações HTTPS",
                    nl: "HTTPS-aanvraaglimiet",
                    fr: "Limite des requêtes HTTPS",
                    it: "Limite delle richieste HTTPS",
                    es: "Límite de solicitudes HTTPS",
                    pl: "Limit żądań HTTPS",
                    uk: "Ліміт HTTPS-запитів",
                    "zh-cn": "HTTPS 请求限制",
                },
                type: "string",
                role: "json",
                desc: "Create by Adapter",
                read: true,
                write: false,
                def: JSON.stringify({
                    requestCount: 0,
                    requestLast: 0,
                    requestTime: "",
                    requestBlock: false,
                    day: "",
                    request: [],
                }),
            };
            await this.sunseeker.createDataPoint(
                `${this.namespace}.rateLimit.request`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
    }

    async setRestartCount() {
        await this.setState(`rateLimit.restart`, { val: JSON.stringify(this.restartLimit), ack: true });
    }

    /**
     * @param {string} email
     */
    isValidSyntax(email) {
        const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        return email.length <= 254 && EMAIL_REGEX.test(email);
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
