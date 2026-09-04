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
        this.on("message", this.onMessage.bind(this));

        this.json2iob = new Json2iob(this);
        /** @type {Sunseeker | null} */
        this.sunseeker = null;
        this.updateDeviceSet = null;
        this.updateDeviceStateChange = null;
        this.createObjectDone = {};
        this.firstStart = {};
        this.firstStartTimeout = null;
        this.availableMaps = null;
        this.regionsCounter = {};
        this.regionId = {};
        this.notice = {};
        this.restartLimit = {
            restartCount: 0,
            restartLast: 0,
            restartTime: "",
            day: "01-01",
        };
    }

    async onReady() {
        //ToDo Multiple MQTT connections (V! + new + old)
        //ToDo Forced internet disconnection - Add rate limit
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

        this.sunseeker = new Sunseeker(cfg.username, cfg.password, this, {
            region: cfg.region || "EU",
            apptype: cfg.apptype || "New",
            language: cfg.language || "de-DE",
            interval: Number(cfg.interval) > 59 && Number(cfg.interval) < 1441 ? Number(cfg.interval) : 300,
            refreshAfterMqttMs: 60 * 1000,
        });

        await this.createAuth();

        if (isPWChanged) {
            this.setSession();
            isPWChanged = false;
        }

        this.sunseeker.on("devices", payload => this.onSunseekerDevices(payload));
        this.sunseeker.on("records", payload => this.onSunseekerRecords(payload));
        this.sunseeker.on("status", payload => this.onSunseekerStatus(payload));
        this.sunseeker.on("zigzag", payload => this.onSunseekerMultiZigZag(payload));
        this.sunseeker.on("customZigzag", payload => this.onSunseekerCustomMultiZigZag(payload));
        this.sunseeker.on("notice", payload => this.onSunseekerNotice(payload));
        this.sunseeker.on("mqtt", payload => this.onSunseekerMqtt(payload));
        this.sunseeker.on("objectExists", payload => this.onSunseekerObjectExists(payload));
        this.sunseeker.on("map", payload => this.onSunseekerMap(payload));
        this.sunseeker.on("livemap", payload => this.onSunseekerLivemap(payload));
        this.sunseeker.on("firmware", payload => this.onSunseekerFirmware(payload));
        this.sunseeker.on("mqttConnect", () => this.setState("info.connection", true, true));
        this.sunseeker.on("mqttDisconnect", () => this.setState("info.connection", false, true));
        this.sunseeker.on("error", err => this.log.error(`mqtt error: ${err.message || String(err)}`));
        this.sunseeker.on("own", payload => this.onSunseekerOwn(payload));
        this.sunseeker.on("mqtt_auth", payload => this.onSunseekerMqttAuth(payload));
        this.sunseeker.on("session", payload => this.onSunseekerSession(payload));
        this.sunseeker.on("mode", payload => this.onSunseekerScheduleMode(payload));

        this.subscribeStates("*");

        try {
            await this.sunseeker.start();
        } catch (err) {
            this.log.error(`Start failed: ${err.message}`);
            return;
        }
        this.setState("info.connection", true, true);

        try {
            await this.sunseeker.updateAllDevices();
        } catch (err) {
            this.log.warn(`Initial-Update: ${err.message}`);
        }
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
                mqtt.val != ""
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
                check_key.val != ""
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
                case "sendOwnRequest":
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, [{ info: "In progress" }], obj.callback);
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
            if (this.sunseeker) {
                this.sunseeker.stop();
                this.sunseeker = null;
            }
            this.firstStartTimeout && this.clearTimeout(this.firstStartTimeout);
            this.updateDeviceSet && this.clearTimeout(this.updateDeviceSet);
            this.updateDeviceStateChange && this.clearTimeout(this.updateDeviceStateChange);
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
            faultStatusCode: { ...ERRORTYPE_LABELS },
            status: states,
        };
    }

    /**
     * @param {string} path
     */
    onSunseekerObjectExists(path) {
        this.createObjectDone[path] = true;
    }

    async onSunseekerDevices({ devices }) {
        if (!Array.isArray(devices)) {
            return;
        }
        let common;
        for (const d of devices) {
            const sn = d.deviceSn.replace(/this.FORBIDDEN_CHARS/gu, "_");
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
                    name: d.deviceName || sn,
                    icon: d["picUrlData"] != null ? d["picUrlData"] : "img/mower.png",
                    statusStates: {
                        onlineId: `${this.namespace}.${sn}.mower_raw.onlineFlag`,
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
                            icon: "img/map.png",
                        };
                        await this.sunseeker.createDataPoint(
                            `${this.namespace}.${path}.zones`,
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
                roles: {
                    picUrl: "text.url",
                    picUrlDetail: "text.url",
                },
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
                    en: "Event log as JSON",
                    de: "Ereignisprotokoll als JSON",
                    ru: "Журнал событий в формате JSON",
                    pt: "Registro de eventos em formato JSON",
                    nl: "Gebeurtenislogboek als JSON",
                    fr: "Journal des événements au format JSON",
                    it: "Registro eventi in formato JSON",
                    es: "Registro de eventos como JSON",
                    pl: "Dziennik zdarzeń jako JSON",
                    uk: "Журнал подій у форматі JSON",
                    "zh-cn": "事件日志（JSON格式）",
                },
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
                type: "string",
                role: "json",
                write: false,
                read: true,
                def: JSON.stringify({}),
            };
            await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "state", null, null, null);
        }
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
        this.log.debug(`${sn} - ${JSON.stringify(data)}`);
        const meta = this.sunseeker.deviceMeta[sn];
        this.log.debug(`Region: ${JSON.stringify(meta.custom_multi_sort)}`);
        const count_sort = Object.keys(meta.custom_multi_sort).length;
        const count_custom = typeof data.custom === "object" ? data.custom.length : 0;
        this.log.debug(`Multi: ${count_sort} - ${count_custom}`);
        if (count_custom != count_sort) {
            //Why is there a difference?
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
                    this.log.warn(`Cannot found id ${custom.id} - ${JSON.stringify(custom)}`);
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
                            de: "Neuer Multi-Angle (aktivieren/deaktivieren)",
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
                            en: "Create new Multi-Angle",
                            de: "Neue Multi-Angle-Funktion erstellen",
                            ru: "Создать новый многоракурсный режим",
                            pt: "Criar novo ângulo múltiplo",
                            nl: "Maak een nieuwe multi-angle aan",
                            fr: "Créer un nouveau multi-angle",
                            it: "Crea nuovo Multi-angolo",
                            es: "Crear nuevo ángulo múltiple",
                            pl: "Utwórz nowy Multi-Angle",
                            uk: "Створити новий багатокутний об'єкт",
                            "zh-cn": "创建新的多角度",
                        },
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
                roles: {
                    lat: "value.gps.latitude",
                    lng: "value.gps.longitude",
                    picUrl: "text.url",
                    url: "text.url",
                },
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
            this.setMowerRaw(sn, data);
            return;
        }
        if (data.custom) {
            this.onSunseekerCustomMultiZigZag({ sn, data });
            return;
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
            this.setMowerRaw(sn, data_file);
            return;
        }
        if (id == "setDivideArea") {
            const data_area = {
                area_info: {
                    map_id: data.area_info[0].map_id,
                    vertexs: data.area_info[0].vertexs,
                },
            };
            this.setMowerRaw(sn, data_area);
            return;
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
            roles: {
                lat: "value.gps.latitude",
                lng: "value.gps.longitude",
                picUrl: "text.url",
                url: "text.url",
            },
            states: this.statesForDevice(sn),
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
                type: "string",
                role: "state",
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
     * @param {any} payload
     */
    async onSunseekerSession(payload) {
        const obj = Object.assign({}, payload);
        obj.access_token = this.encrypt(obj.access_token);
        obj.refresh_token = this.encrypt(obj.refresh_token);
        await this.setState(`auth.session`, { val: JSON.stringify(obj), ack: true });
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
                type: "string",
                role: "state",
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
            try {
                const map_info = JSON.parse(data);
                /**
                if (map_info && this.sunseeker) {
                    if (map_info.region_channel) {
                        if (!Array.isArray(map_info.region_channel)) {
                            return;
                        }
                        if (map_info.region_channel.length > 0) {
                            this.regionsCounter[sn].passage = map_info.region_channel.length;
                            await this.json2iob.parse(`${sn}.map.passages`, map_info.region_channel, {
                                channelName: {
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
                            this.sunseeker.addDeleteObject(sn, map_info.region_channel, "passages", "passage", lang_p);
                        } else {
                            if (this.regionsCounter[sn].passage > 0) {
                                this.regionsCounter[sn].passage = 0;
                                await this.delObjectAsync(`${this.namespace}.${sn}.map.passages`, {
                                    recursive: true,
                                });
                            }
                        }
                    }
                    if (map_info.region_forbidden) {
                        if (!Array.isArray(map_info.region_forbidden)) {
                            return;
                        }
                        if (map_info.region_forbidden.length > 0) {
                            this.regionsCounter[sn].forbidden = map_info.region_forbidden.length;
                            await this.json2iob.parse(`${sn}.map.forbidden`, map_info.region_forbidden, {
                                channelName: {
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
                            this.sunseeker.addDeleteObject(
                                sn,
                                map_info.region_forbidden,
                                "forbidden",
                                "forbidden",
                                lang_f,
                            );
                        } else {
                            if (this.regionsCounter[sn].forbidden > 0) {
                                this.regionsCounter[sn].forbidden = 0;
                                await this.delObjectAsync(`${this.namespace}.${sn}.map.forbidden`, {
                                    recursive: true,
                                });
                            }
                        }
                    }
                    if (map_info.region_obstacle) {
                        if (!Array.isArray(map_info.region_obstacle)) {
                            return;
                        }
                        if (map_info.region_obstacle.length > 0) {
                            this.regionsCounter[sn].obstacle = map_info.region_obstacle.length;
                            await this.json2iob.parse(`${sn}.map.obstacles`, map_info.region_obstacle, {
                                channelName: {
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
                            this.sunseeker.addDeleteObject(
                                sn,
                                map_info.region_obstacle,
                                "obstacles",
                                "obstacle",
                                lang_o,
                            );
                        } else {
                            if (this.regionsCounter[sn].obstacle > 0) {
                                this.regionsCounter[sn].obstacle = 0;
                                await this.delObjectAsync(`${this.namespace}.${sn}.map.obstacles`, {
                                    recursive: true,
                                });
                            }
                        }
                    }
                    if (map_info.region_placed_blank) {
                        if (!Array.isArray(map_info.region_placed_blank)) {
                            return;
                        }
                        if (map_info.region_placed_blank.length > 0) {
                            this.regionsCounter[sn].placed = map_info.region_placed_blank.length;
                            await this.json2iob.parse(`${sn}.map.placed_blank`, map_info.region_placed_blank, {
                                channelName: {
                                    en: "Placed blank areas",
                                    de: "Platzierte leere Bereiche",
                                    ru: "Заполненные пустые области",
                                    pt: "Áreas em branco inseridas",
                                    nl: "Ingevulde lege gebieden",
                                    fr: "Zones vides placées",
                                    it: "Posizionamento di aree vuote",
                                    es: "Se colocaron áreas en blanco",
                                    pl: "Umieszczono puste obszary",
                                    uk: "Розміщені порожні області",
                                    "zh-cn": "放置空白区域",
                                },
                                forceIndex: true,
                            });
                            const lang_pl = {
                                en: "Placed blank area delete",
                                de: "Platzierten leeren Bereich löschen",
                                ru: "Размещено пустое место, удалить",
                                pt: "Área em branco excluída",
                                nl: "Leeg gebied verwijderd",
                                fr: "Supprimer la zone vide insérée",
                                it: "Area vuota inserita elimina",
                                es: "Área en blanco colocada eliminar",
                                pl: "Umieszczony pusty obszar usuń",
                                uk: "Видалення розміщеної порожньої області",
                                "zh-cn": "放置空白区域删除",
                            };
                            this.sunseeker.addDeleteObject(
                                sn,
                                map_info.region_placed_blank,
                                "placed",
                                "placed",
                                lang_pl,
                            );
                        } else {
                            if (this.regionsCounter[sn].placed > 0) {
                                this.regionsCounter[sn].placed = 0;
                                await this.delObjectAsync(`${this.namespace}.${sn}.map.placed_blank`, {
                                    recursive: true,
                                });
                            }
                        }
                    }
                    if (map_info.region_blank) {
                        if (!Array.isArray(map_info.region_blank)) {
                            return;
                        }
                        if (map_info.region_blank.length > 0) {
                            this.regionsCounter[sn].blaank = map_info.region_blank.length;
                            await this.json2iob.parse(`${sn}.map.blanks`, map_info.region_blank, {
                                channelName: {
                                    en: "Blank areas",
                                    de: "Leere Bereiche",
                                    ru: "Пустые участки",
                                    pt: "Áreas em branco",
                                    nl: "Lege gebieden",
                                    fr: "Zones vides",
                                    it: "Area vuota",
                                    es: "Áreas en blanco",
                                    pl: "Puste obszary",
                                    uk: "Пусті області",
                                    "zh-cn": "空白区域",
                                },
                                forceIndex: true,
                            });
                            const lang_b = {
                                en: "Blank area delete",
                                de: "Leeren Bereich löschen",
                                ru: "Удалить пустую область",
                                pt: "Excluir área em branco",
                                nl: "Leeg gebied verwijderen",
                                fr: "Supprimer la zone vide",
                                it: "area vuota elimina",
                                es: "eliminar área en blanco",
                                pl: "Usuń pusty obszar",
                                uk: "Видалення порожньої області",
                                "zh-cn": "空白区域删除",
                            };
                            this.sunseeker.addDeleteObject(sn, map_info.region_placed_blank, "blanks", "blank", lang_b);
                        } else {
                            if (this.regionsCounter[sn].blank > 0) {
                                this.regionsCounter[sn].blank = 0;
                                await this.delObjectAsync(`${this.namespace}.${sn}.map.blanks`, {
                                    recursive: true,
                                });
                            }
                        }
                    }
                }
                 */
                if (map_info && map_info.region_work) {
                    if (!Array.isArray(map_info.region_work)) {
                        return;
                    }
                    if (this.sunseeker) {
                        this.regionId[sn] = [];
                        const meta = this.sunseeker.deviceMeta[sn];
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
                    }
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
        if (!raw.online) {
            this.log.warn(`onStateChange: Device ${parts[2]} is offline`);
            return;
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
        const mapIdx = parts.indexOf("map");
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
                        //const meta = this.sunseeker.deviceMeta[snr];
                        /**
                         * type = 0 region_workzone
                         * type = 2 region_passage
                         * type = 3 region_obstacle
                         * type = 4 region_forbidden
                         */
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
                if (typeof state.val === "string") {
                    const numberFormat = /^\d{4}$/;
                    if (numberFormat.test(state.val)) {
                        const pin_old = await this.getStateAsync(`${sn}.settings.pin_old`);
                        if (pin_old && typeof pin_old.val === "string") {
                            if (numberFormat.test(pin_old.val)) {
                                this.sunseeker.changePin(sn, pin_old.val, state.val);
                                this.setState(id, { val: "", ack: true });
                                this.setState(`${sn}.settings.pin_old`, { val: "", ack: true });
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
                    this.sunseeker.setSettings(sn, state.val, "setNightWork", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
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
                    this.sunseeker.setSettings(sn, state.val, "setEnergySavingMode", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "follow_border_freq") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    this.sunseeker.setSettings(sn, state.val, "setFollowBorderFreq", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "recharge_mode") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1 || state.val == 2)) {
                    this.sunseeker.setSettings(sn, state.val, "setRechargeMode", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "plan_mode") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.sunseeker.setPlanMode(sn, state.val, null);
                    this.setState(id, { val: state.val, ack: true });
                } else if (typeof state.val === "number" && state.val == 4) {
                    this.sendZigZag(id, sn, state.val, false);
                }
                return;
            }
            if (leaf === "dev_name") {
                if (typeof state.val === "string" && state.val != "") {
                    this.sunseeker.setDeviceName(sn, state);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "auto_upgrade") {
                if (typeof state.val === "boolean") {
                    this.sunseeker.setAutoUpgrade(sn, state);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "dev_model") {
                if (typeof state.val === "string" && state.val != "") {
                    this.sunseeker.setSettings(sn, state.val, "setDevModel", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "workSpeed") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    const gap = await this.getStateAsync(`${sn}.settings.gap`);
                    if (gap && gap.val != null && (gap.val == 1 || gap.val == 2 || gap.val == 3)) {
                        this.sunseeker.setMowEfficiency(sn, gap.val, state.val);
                        this.setState(id, { val: state.val, ack: true });
                    }
                }
                return;
            }
            if (leaf === "gap") {
                if (typeof state.val === "number" && (state.val == 1 || state.val == 2 || state.val == 3)) {
                    const speed = await this.getStateAsync(`${sn}.settings.workSpeed`);
                    if (speed && speed.val != null && (speed.val == 1 || speed.val == 2 || speed.val == 3)) {
                        this.sunseeker.setMowEfficiency(sn, state.val, speed.val);
                        this.setState(id, { val: state.val, ack: true });
                    }
                }
                return;
            }
            if (leaf === "work_touch_mode") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.sunseeker.setSettings(sn, state.val, "setWorkTouchMode", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "auto_ride_edge_map_m") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.sunseeker.setSettings(sn, state.val, "setAutoRideEdgeMapM", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "custom_flag") {
                if (typeof state.val === "boolean") {
                    this.sunseeker.setSettings(sn, state.val, "setCustomFlag", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "first_along_border") {
                if (typeof state.val === "boolean") {
                    this.sunseeker.setSettings(sn, state.val, "setFirstAlongBorder", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "dis_along_border") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.sunseeker.setSettings(sn, state.val, "setDisAlongBorder", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
                }
                return;
            }
            if (leaf === "ai_sensitivity") {
                if (typeof state.val === "number" && (state.val == 0 || state.val == 1)) {
                    this.sunseeker.setSettings(sn, state.val, "setDisAlongBorder", leaf, null);
                    this.setState(id, { val: state.val, ack: true });
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
        const sn = parts[remoteIdx - 1];
        const command = parts[remoteIdx + 1];

        if (!this.sunseeker.devicesRaw[sn]) {
            this.log.warn(`onStateChange: Device ${sn} unknown`);
            return;
        }
        this.sendRemoteCommand(id, sn, command, state);
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
            await this.sunseeker.setBlade(sn, key, Number(state.val));
            this.updateDeviceAfterStateChange(sn);
            this.setState(id, { val: state.val, ack: true });
        } catch (err) {
            this.log.error(`Blade-${key} for ${sn} failed: ${err.message}`);
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
            await this.sunseeker.setRain(sn, Boolean(flagVal), Math.round(Number(durVal) || 0));
            this.updateDeviceAfterStateChange(sn);
            this.setState(id, { val: state.val, ack: true });
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
            } else if (command === "set_screen_durration") {
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
                if (raw.plan_mode === 2 || raw.plan_mode === 3 || raw.plan_mode > 4 || raw.plan_mode < 0) {
                    this.log.error(`plan_mode: Only 0, 1 and 4 are allowed!`);
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
                this.sunseeker.setPlanMode(sn, 4, zigzag);
                this.setState(id, { val: false, ack: true });
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
                    for (const zigzag of json.multi_zigzag_angles) {
                        if (state != `0${count}`) {
                            zigzag.push(zigzag);
                        }
                    }
                    if (zigzag.length == 0) {
                        delete json.multi_zigzag_angles;
                        json.plan_mode = 0;
                    } else {
                        json.plan_mode = 4;
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
            if (!isActive || zigzag.length == 0) {
                this.sunseeker.setPlanMode(sn, 0, null);
            } else {
                this.sunseeker.setPlanMode(sn, 4, zigzag);
            }
            this.setState(id, { val: "00", ack: true });
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
            if (!isActive) {
                this.sunseeker.setPlanMode(sn, 0, null);
            } else {
                this.sunseeker.setPlanMode(sn, state, zigzag);
            }
            this.setState(id, { val: state, ack: true });
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
        if (typeof obj.firmwareVersion === "number") {
            delete obj.firmwareVersion;
        }
        if (typeof obj.rainDelayDuration === "string") {
            obj.rainDelayDuration = parseInt(obj.rainDelayDuration);
        }
        if (typeof obj.workStatusCode === "number") {
            obj.workStatusCode = obj.workStatusCode.toString();
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
            path = `${sn}.map.maps`;
            if (!this.createObjectDone[path] && this.sunseeker) {
                this.createObjectDone[path] = true;
                common = {
                    icon: "img/map.png",
                };
                await this.sunseeker.createDataPoint(`${this.namespace}.${path}`, common, "channel", null, true, null);
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
                    this.sunseeker.setStates(sn, { map_temp_name: mapName }, this.createObjectDone);
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
}

if (require.main !== module) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = options => new SunseekerAdapter(options);
} else {
    new SunseekerAdapter();
}
