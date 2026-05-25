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
        this.createObjectDone = {};
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
                channelName: {
                    en: "Generally",
                    de: "Allgemein",
                    ru: "В целом",
                    pt: "Geralmente",
                    nl: "Algemeen",
                    fr: "En général",
                    it: "Generalmente",
                    es: "Generalmente",
                    pl: "Ogólnie",
                    uk: "Зазвичай",
                    "zh-cn": "一般来说",
                },
                forceIndex: false,
                roles: {
                    picUrl: "text.url",
                    picUrlDetail: "text.url",
                },
            });
            await this.ensureRemoteButtons(sn);
            await this.ensureScheduleStates(sn);
        }
    }

    async onSunseekerStatus({ sn, status, settings }) {
        const states = this.statesForDevice(sn);
        if (status) {
            await this.json2iob.parse(`${sn}.status`, status, {
                channelName: {
                    en: "Status",
                    de: "Status",
                    ru: "Статус",
                    pt: "Status",
                    nl: "Status",
                    fr: "Statut",
                    it: "Stato",
                    es: "Estado",
                    pl: "Status",
                    uk: "Статус",
                    "zh-cn": "地位",
                },
                forceIndex: false,
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
            await this.ensureWritableSettings(sn, normalized);
            await this.json2iob.parse(`${sn}.settings`, normalized, {
                channelName: {
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
            channelName: {
                en: "Status",
                de: "Status",
                ru: "Статус",
                pt: "Status",
                nl: "Status",
                fr: "Statut",
                it: "Stato",
                es: "Estado",
                pl: "Status",
                uk: "Статус",
                "zh-cn": "地位",
            },
            forceIndex: false,
            roles: {
                lat: "value.gps.latitude",
                lng: "value.gps.longitude",
                picUrl: "text.url",
                url: "text.url",
            },
            states: this.statesForDevice(sn),
        });
    }

    async onSunseekerMap({ sn, kind, payload }) {
        if (kind === "info") {
            await this.json2iob.parse(`${sn}.map.info`, payload, {
                channelName: {
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
                forceIndex: false,
                roles: {
                    mapPathFileUrl: "text.url",
                    realPathFileUlr: "text.url",
                },
            });
            return;
        }
        if (kind === "backup") {
            await this.extendObject(`${sn}.map.backup`, {
                type: "state",
                common: {
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
            common: {
                name: {
                    en: "Commands",
                    de: "Befehle",
                    ru: "Команды",
                    pt: "Comandos",
                    nl: "Commando's",
                    fr: "Commandes",
                    it: "Comandi",
                    es: "Comandos",
                    pl: "Polecenia",
                    uk: "Команди",
                    "zh-cn": "命令",
                },
            },
            native: {},
        });
        const buttons = [
            [
                "start",
                {
                    en: "Mowing start",
                    de: "Mähen starten",
                    ru: "Начало кошения",
                    pt: "Início da poda",
                    nl: "Maaien begint",
                    fr: "Début de la tonte",
                    it: "Inizio falciatura",
                    es: "Inicio del corte de césped",
                    pl: "Rozpoczęcie koszenia",
                    uk: "Початок скошування",
                    "zh-cn": "割草开始",
                },
            ],
            [
                "pause",
                {
                    en: "Pause",
                    de: "Pause",
                    ru: "Пауза",
                    pt: "Pausa",
                    nl: "Pauze",
                    fr: "Pause",
                    it: "Pausa",
                    es: "Pausa",
                    pl: "Pauza",
                    uk: "Пауза",
                    "zh-cn": "暂停",
                },
            ],
            [
                "dock",
                {
                    en: "To the Charging Station",
                    de: "Zur Ladestation",
                    ru: "К зарядной станции",
                    pt: "Para a estação de carregamento",
                    nl: "Naar het laadstation",
                    fr: "Vers la station de recharge",
                    it: "Alla stazione di ricarica",
                    es: "A la estación de carga",
                    pl: "Do stacji ładowania",
                    uk: "До зарядної станції",
                    "zh-cn": "前往充电站",
                },
            ],
            [
                "stop_find_charger",
                {
                    en: "Trip to home cancel",
                    de: "Heimreise abbrechen",
                    ru: "Отмена поездки домой",
                    pt: "Cancelamento da viagem para casa",
                    nl: "Reis naar huis geannuleerd",
                    fr: "Annulation du voyage à domicile",
                    it: "Annulla il viaggio verso casa",
                    es: "Cancelación del viaje a casa",
                    pl: "Odwołanie podróży do domu",
                    uk: "Скасувати поїздку додому",
                    "zh-cn": "取消回家行程",
                },
            ],
            [
                "border",
                {
                    en: "Edge cut run",
                    de: "Kantenschnittlauf",
                    ru: "Краевой срез",
                    pt: "corte de borda",
                    nl: "Randafsnijding",
                    fr: "Course de coupe de bord",
                    it: "Taglio del bordo",
                    es: "Corte de borde",
                    pl: "Cięcie krawędziowe",
                    uk: "Вирізання краю",
                    "zh-cn": "边缘切割",
                },
            ],
            [
                "stop",
                {
                    en: "Stop",
                    de: "Stoppen",
                    ru: "Останавливаться",
                    pt: "Parar",
                    nl: "Stop",
                    fr: "Arrêt",
                    it: "Fermare",
                    es: "Detener",
                    pl: "Zatrzymywać się",
                    uk: "СТІЙ",
                    "zh-cn": "停止",
                },
            ],
            [
                "stop_task",
                {
                    en: "Cancel Task",
                    de: "Aufgabe abbrechen",
                    ru: "Отменить задачу",
                    pt: "Cancelar tarefa",
                    nl: "Taak annuleren",
                    fr: "Annuler la tâche",
                    it: "Annulla attività",
                    es: "Cancelar tarea",
                    pl: "Anuluj zadanie",
                    uk: "Скасувати завдання",
                    "zh-cn": "取消任务",
                },
            ],
            [
                "restart",
                {
                    en: "Restart Task",
                    de: "Aufgabe neu starten",
                    ru: "Перезапустить задачу",
                    pt: "Reiniciar tarefa",
                    nl: "Taak opnieuw starten",
                    fr: "Tâche de redémarrage",
                    it: "Riavvia l'attività",
                    es: "Reiniciar tarea",
                    pl: "Uruchom ponownie zadanie",
                    uk: "Перезапустити завдання",
                    "zh-cn": "重启任务",
                },
            ],
            [
                "refresh",
                {
                    en: "Reload Status",
                    de: "Status neu laden",
                    ru: "Статус перезагрузки",
                    pt: "Recarregar status",
                    nl: "Herlaadstatus",
                    fr: "État du rechargement",
                    it: "Stato ricarica",
                    es: "Estado de recarga",
                    pl: "Status ponownego ładowania",
                    uk: "Стан поповнення",
                    "zh-cn": "重新加载状态",
                },
            ],
        ];
        for (const [id, name] of buttons) {
            await this.extendObject(`${sn}.remote.${id}`, {
                type: "state",
                common: {
                    name: name,
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
            common: {
                name: {
                    en: "Schedule Planner",
                    de: "Terminplaner",
                    ru: "Планировщик расписаний",
                    pt: "Planejador de Horários",
                    nl: "Planningsplanner",
                    fr: "Planificateur d'horaire",
                    it: "Pianificatore di programmi",
                    es: "Planificador de horarios",
                    pl: "Planer harmonogramu",
                    uk: "Планувальник розкладу",
                    "zh-cn": "日程规划器",
                },
            },
            native: {},
        });
        const days = [
            [
                "monday",
                {
                    en: "Monday (HH:MM-HH:MM, empty = off)",
                    de: "Montag (HH:MM-HH:MM, leer = aus)",
                    ru: "Понедельник (ЧЧ:ММ-ЧЧ:ММ, пустой = выключен)",
                    pt: "Segunda-feira (HH:MM-HH:MM, vazio = desligado)",
                    nl: "Maandag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Lundi (HH:MM-HH:MM, vide = désactivé)",
                    it: "Lunedì (HH:MM-HH:MM, vuoto = chiuso)",
                    es: "Lunes (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Poniedziałek (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "Понеділок (ГГ:ХХ-ГГ:ХХ, порожній = вихідний)",
                    "zh-cn": "星期一（HH:MM-HH:MM，空表示休息）",
                },
            ],
            [
                "tuesday",
                {
                    en: "Tuesday (HH:MM-HH:MM, empty = off)",
                    de: "Dienstag (HH:MM-HH:MM, leer = aus)",
                    ru: "Вторник (ЧЧ:ММ-ЧЧ:ММ, пусто = выключено)",
                    pt: "Terça-feira (HH:MM-HH:MM, vazio = desligado)",
                    nl: "Dinsdag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Mardi (HH:MM-HH:MM, vide = désactivé)",
                    it: "Martedì (HH:MM-HH:MM, vuoto = spento)",
                    es: "Martes (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Wtorek (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "Вівторок (ГГ:ХХ-ГГ:ХХ, порожній = вихідний)",
                    "zh-cn": "星期二（HH:MM-HH:MM，空表示休息）",
                },
            ],
            [
                "wednesday",
                {
                    en: "Wednesday (HH:MM-HH:MM, empty = off)",
                    de: "Mittwoch (HH:MM-HH:MM, leer = aus)",
                    ru: "Среда (ЧЧ:ММ-ЧЧ:ММ, пусто = выключено)",
                    pt: "Quarta-feira (HH:MM-HH:MM, vazio = fechado)",
                    nl: "Woensdag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Mercredi (HH:MM-HH:MM, vide = désactivé)",
                    it: "Mercoledì (HH:MM-HH:MM, vuoto = spento)",
                    es: "Miércoles (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Środa (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "Середа (ГГ:ХХ-ГГ:ХХ, порожній = вимкнено)",
                    "zh-cn": "星期三（HH:MM-HH:MM，空表示休息）",
                },
            ],
            [
                "thursday",
                {
                    en: "Thursday (HH:MM-HH:MM, empty = off)",
                    de: "Donnerstag (HH:MM-HH:MM, leer = aus)",
                    ru: "Четверг (ЧЧ:ММ-ЧЧ:ММ, пусто = выключено)",
                    pt: "Quinta-feira (HH:MM-HH:MM, vazio = fechado)",
                    nl: "Donderdag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Jeudi (HH:MM-HH:MM, vide = désactivé)",
                    it: "Giovedì (HH:MM-HH:MM, vuoto = non disponibile)",
                    es: "Jueves (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Czwartek (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "Четвер (ГГ:ХХ-ГГ:ХХ, порожній = вихідний)",
                    "zh-cn": "星期四（HH:MM-HH:MM，空表示休息）",
                },
            ],
            [
                "friday",
                {
                    en: "Friday (HH:MM-HH:MM, empty = off)",
                    de: "Freitag (HH:MM-HH:MM, leer = aus)",
                    ru: "Пятница (ЧЧ:ММ-ЧЧ:ММ, пусто = выключено)",
                    pt: "Sexta-feira (HH:MM-HH:MM, vazio = fechado)",
                    nl: "Vrijdag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Vendredi (HH:MM-HH:MM, vide = désactivé)",
                    it: "Venerdì (HH:MM-HH:MM, vuoto = non disponibile)",
                    es: "Viernes (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Piątek (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "П'ятниця (ГГ:ХХ-ГГ:ХХ, порожній = вихідний)",
                    "zh-cn": "星期五（HH:MM-HH:MM，空表示休息）",
                },
            ],
            [
                "saturday",
                {
                    en: "Saturday (HH:MM-HH:MM, empty = off)",
                    de: "Samstag (HH:MM-HH:MM, leer = aus)",
                    ru: "Суббота (ЧЧ:ММ-ЧЧ:ММ, пусто = выключено)",
                    pt: "Sábado (HH:MM-HH:MM, vazio = fechado)",
                    nl: "Zaterdag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Samedi (HH:MM-HH:MM, vide = désactivé)",
                    it: "Sabato (HH:MM-HH:MM, vuoto = chiuso)",
                    es: "Sábado (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Sobota (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "Субота (ГГ:ХХ-ГГ:ХХ, порожній = вихідний)",
                    "zh-cn": "星期六（HH:MM-HH:MM，空表示休息）",
                },
            ],
            [
                "sunday",
                {
                    en: "Sunday (HH:MM-HH:MM, empty = off)",
                    de: "Sonntag (HH:MM-HH:MM, leer = aus)",
                    ru: "Воскресенье (ЧЧ:ММ-ЧЧ:ММ, пусто = выключено)",
                    pt: "Domingo (HH:MM-HH:MM, vazio = desligado)",
                    nl: "Zondag (HH:MM-HH:MM, leeg = uit)",
                    fr: "Dimanche (HH:MM-HH:MM, vide = désactivé)",
                    it: "Domenica (HH:MM-HH:MM, vuoto = chiuso)",
                    es: "Domingo (HH:MM-HH:MM, vacío = apagado)",
                    pl: "Niedziela (GG:MM-GG:MM, puste = wyłączone)",
                    uk: "Неділя (ГГ:ХХ-ГГ:ХХ, порожній = вихідний)",
                    "zh-cn": "星期日（HH:MM-HH:MM，空表示休息）",
                },
            ],
        ];
        for (const [key, label] of days) {
            await this.extendObject(`${sn}.schedule.${key}`, {
                type: "state",
                common: {
                    name: label,
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
                name: {
                    en: "Schedule paused",
                    de: "Zeitplan pausiert",
                    ru: "Расписание приостановлено",
                    pt: "Programação pausada",
                    nl: "Planning gepauzeerd",
                    fr: "Programme suspendu",
                    it: "Programma sospeso",
                    es: "Programación pausada",
                    pl: "Harmonogram wstrzymany",
                    uk: "Розклад призупинено",
                    "zh-cn": "行程暂停",
                },
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
                name: {
                    en: "Send schedule",
                    de: "Zeitplan senden",
                    ru: "Отправить расписание",
                    pt: "Enviar cronograma",
                    nl: "Schema verzenden",
                    fr: "Envoyer le planning",
                    it: "Invia programma",
                    es: "Enviar horario",
                    pl: "Wyślij harmonogram",
                    uk: "Надіслати розклад",
                    "zh-cn": "发送日程安排",
                },
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
        let path = "";
        if (this.config.apptype !== "Old") {
            if (Object.prototype.hasOwnProperty.call(settingsData, "bladeSpeed")) {
                path = `${sn}.settings.bladeSpeed`;
                if (!this.createObjectDone[path]) {
                    this.createObjectDone[path] = true;
                    await this.extendObject(path, {
                        type: "state",
                        common: {
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
                        },
                        native: {},
                    });
                }
            }
            if (Object.prototype.hasOwnProperty.call(settingsData, "bladeHeight")) {
                path = `${sn}.settings.bladeHeight`;
                if (!this.createObjectDone[path]) {
                    this.createObjectDone[path] = true;
                    await this.extendObject(`${sn}.settings.bladeHeight`, {
                        type: "state",
                        common: {
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
                        },
                        native: {},
                    });
                }
            }
        }
        if (Object.prototype.hasOwnProperty.call(settingsData, "rainFlag")) {
            path = `${sn}.settings.rainFlag`;
            if (!this.createObjectDone[path]) {
                this.createObjectDone[path] = true;
                await this.extendObject(`${sn}.settings.rainFlag`, {
                    type: "state",
                    common: {
                        name: {
                            en: "Rain delay active",
                            de: "Regenverzögerung aktiv",
                            ru: "Задержка из-за дождя активирована",
                            pt: "Atraso devido à chuva ativo",
                            nl: "Regenvertraging actief",
                            fr: "Retard dû à la pluie",
                            it: "Tempo di sospensione per pioggia attivo",
                            es: "Retraso por lluvia activo",
                            pl: "Aktywne opóźnienie deszczu",
                            uk: "Затримка дощу активна",
                            "zh-cn": "雨天延误生效",
                        },
                        type: "boolean",
                        role: "switch",
                        read: true,
                        write: true,
                    },
                    native: {},
                });
            }
        }
        if (Object.prototype.hasOwnProperty.call(settingsData, "rainDelayDuration")) {
            path = `${sn}.settings.rainDelayDuration`;
            if (!this.createObjectDone[path]) {
                this.createObjectDone[path] = true;
                await this.extendObject(`${sn}.settings.rainDelayDuration`, {
                    type: "state",
                    common: {
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
                    },
                    native: {},
                });
            }
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
