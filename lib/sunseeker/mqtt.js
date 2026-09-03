"use strict";

const crypto = require("node:crypto");
const mqtt = require("mqtt");

const MQTT_OLD_HOST = "mqtts.sk-robot.com";
const MQTT_OLD_PORT = 1883;
const MQTT_OLD_USER = "app";
const MQTT_OLD_PASS = "h4ijwkTnyrA";

module.exports = {
    /** Dispatch by apptype: New (S/X/V/V1 brokers) vs. Old (legacy broker). */
    initMqtt() {
        //ToDo not in use
        if (this.options.apptype === "New") {
            this.startMqttNew();
        } else {
            this.startMqttOld();
        }
    },

    async startMqttNew() {
        if (this.unloading) {
            return;
        }
        try {
            await this.ensureAppId();
            // Mirror the app 1.7.0: read the per-appId user info first
            // (mqttsPasswordFlag + broker domain), then only (re)set the
            // password when the account has none yet or we don't hold the
            // current plaintext. Otherwise reuse it (connect without edit).
            await this.getAppUserInfo().catch(err => this.iob.log.debug(`app/info: ${err.message}`));
            if (!this.mqttsPasswordFlag || !this.mqttPassword) {
                await this.editMqttPassword();
            }
        } catch (err) {
            this.iob.log.error(`MQTT setup failed: ${err.message}`);
            this.emit("error", err);
            // Do not give up silently: on startup there is no MQTT client yet
            // whose "close" event could trigger a reconnect, so schedule one.
            this.scheduleMqttRetry();
            return;
        }
        if (this.unloading) {
            return;
        }
        this.connectMqtt();
    },

    connectMqtt() {
        if (!this.session?.access_token) {
            this.emit("error", new Error("connectMqtt: No active session"));
            return;
        }
        if (!this.appId) {
            this.emit("error", new Error("connectMqtt: No app id"));
            return;
        }
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
        const username = `${this.session.username || this.username}${this.appId}`;
        const userId = this.session.user_id;
        // App 1.7.0 clientId shape: APP_arod_<8 alnum>_<userId>
        const suffix = this.randomString(8);
        const clientId = `APP_arod_${suffix}_${userId}`;
        this.iob.log.info(`MQTT connection ${url} username=${username} clientId=${clientId}`);
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
            this.statusMqtt = true;
            this.iob.log.info("MQTT connected");
            this.emit("mqttConnect");
            const userId = this.session.user_id;
            const topics = [`/wirelessdevice/${userId}/get`, `/wirelessmower/${userId}/get`];
            for (const t of topics) {
                client.subscribe(t, { qos: 0 }, (err, granted) => {
                    if (err) {
                        this.iob.log.error(`MQTT subscribe ${t}: ${err.message}`);
                    } else {
                        this.iob.log.debug(`MQTT subscribed: ${JSON.stringify(granted)}`);
                    }
                });
            }
            this.fetchInitialProperties().catch(err => this.iob.log.debug(`Initial-Properties: ${err.message}`));
        });

        client.on("message", (topic, payload) => this.onMqttMessage(topic, payload));

        client.on("error", err => {
            if (this.mqttClient !== client) {
                return;
            }
            this.iob.log.warn(`MQTT error: ${err.message}`);
            const code = /** @type {any} */ (err).code;
            if (code === 4 || code === 5 || /not authorized|bad user/i.test(err.message)) {
                // Broker rejected the credentials: drop the cached password and
                // flag so the retry re-runs the edit and provisions a fresh one.
                this.mqttPassword = undefined;
                this.mqttsPasswordFlag = false;
                this.scheduleMqttRetry();
            }
            this.statusMqtt = false;
        });

        client.on("close", () => {
            if (this.mqttClient !== client) {
                return;
            }
            this.iob.log.debug("MQTT closed");
            this.emit("mqttDisconnect");
            if (!this.unloading) {
                this.scheduleMqttRetry();
            }
            this.statusMqtt = false;
        });

        client.on("offline", () => {
            this.iob.log.debug("MQTT offline");
            this.emit("mqttDisconnect");
            this.statusMqtt = false;
        });

        client.on("reconnect", () => {
            this.iob.log.debug("MQTT reconnect");
            this.emit("mqttConnect");
            this.statusMqtt = true;
        });
    },

    scheduleMqttRetry() {
        if (this.unloading || this._mqttRetryTimer) {
            return;
        }
        this._mqttRetryTimer = this.iob.setTimeout(() => {
            this._mqttRetryTimer = null;
            this.startMqttNew().catch(err => this.iob.log.error(`MQTT-Reconnect: ${err.message}`));
        }, 30000);
    },

    startMqttOld() {
        if (this.unloading) {
            return;
        }
        if (!this.session?.user_id) {
            this.emit("error", new Error("startMqttOld: No active session"));
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
        this.iob.log.info(`Connect MQTT (Old) ${url}`);
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
            this.iob.log.info("MQTT (Old) Connected");
            this.emit("mqttConnect");
            const topic = `/app/${userId}/get`;
            client.subscribe(topic, { qos: 0 }, err => {
                if (err) {
                    this.iob.log.error(`MQTT (Old) subscribe ${topic}: ${err.message}`);
                }
            });
            this.statusMqtt = true;
        });
        client.on("message", (topic, payload) => this.onMqttMessage(topic, payload));
        client.on("error", err => {
            if (this.mqttOldClient !== client) {
                return;
            }
            this.iob.log.warn(`MQTT (Old) error: ${err.message}`);
            this.statusMqtt = false;
        });
        client.on("close", () => {
            if (this.mqttOldClient !== client) {
                return;
            }
            this.iob.log.debug("MQTT (Old) closed");
            this.emit("mqttDisconnect");
            if (!this.unloading && !this._mqttOldRetryTimer) {
                this._mqttOldRetryTimer = this.iob.setTimeout(() => {
                    this._mqttOldRetryTimer = null;
                    this.startMqttOld();
                }, 30000);
            }
            this.statusMqtt = false;
        });
        client.on("offline", () => {
            this.iob.log.debug("MQTT offline");
            this.emit("mqttDisconnect");
            this.statusMqtt = false;
        });

        client.on("reconnect", () => {
            this.iob.log.debug("MQTT reconnect");
            this.emit("mqttConnect");
            this.statusMqtt = true;
        });
    },

    /**
     * Absorb MQTT-pushed renderer state (mower pos, charger pos, live path)
     * into per-device meta so the next livemap render picks them up.
     *
     * @param {any} meta
     * @param {any} statusData
     */
    absorbLivemapState(meta, statusData) {
        if (!meta || !statusData || typeof statusData !== "object") {
            return;
        }
        const robot = statusData.robot_pos;
        if (robot && Array.isArray(robot.point) && robot.point.length >= 2) {
            const x = Number(robot.point[0]);
            const y = Number(robot.point[1]);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                meta.robotPos = { x, y, angle: Number(robot.angle) || 0 };
            }
        }
        const charger = statusData.charge_pos;
        if (charger && Array.isArray(charger.point) && charger.point.length >= 2) {
            const x = Number(charger.point[0]);
            const y = Number(charger.point[1]);
            if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
                meta.chargerPos = { x, y, angle: Number(charger.angle) || 0 };
            }
        }
        const pathInfo = statusData.path;
        if (pathInfo && Array.isArray(pathInfo.path)) {
            if (!Array.isArray(meta.livePath)) {
                meta.livePath = [];
            }
            for (const p of pathInfo.path) {
                if (!Array.isArray(p) || p.length < 2) {
                    continue;
                }
                const x = Number(p[0]);
                const y = Number(p[1]);
                if (Number.isFinite(x) && Number.isFinite(y) && !meta.livePath.includes(p)) {
                    meta.livePath.push([x, y]);
                }
            }
            if (meta.livePath.length > 5000) {
                meta.livePath.splice(0, meta.livePath.length - 5000);
            }
        }
    },

    /**
     * Process MQTT Message
     *
     * @param {string} topic
     * @param {Buffer<ArrayBufferLike>} payload
     */
    onMqttMessage(topic, payload) {
        this.iob.log.debug(`MQTT: ${topic} - ${payload.toString("utf8")}`);
        let data;
        try {
            data = JSON.parse(payload.toString("utf8"));
        } catch {
            this.iob.log.debug(`MQTT non-JSON: ${payload.toString("utf8").slice(0, 200)}`);
            return;
        }
        if (!data || typeof data !== "object") {
            return;
        }
        const sn = data.deviceSn.replace(/this.FORBIDDEN_CHARS/gu, "_");
        const meta = this.deviceMeta[sn];
        if (!sn || !this.devicesRaw[sn] || !meta) {
            this.iob.log.debug(`MQTT for an Unknown Device: ${topic} ${JSON.stringify(data).slice(0, 120)}`);
            return;
        }
        this.iob.log.debug(`MQTT ${sn} ${topic}: ${JSON.stringify(data).length} Bytes`);
        let statusData = data.data && typeof data.data === "object" ? data.data : data;
        const id = data && data.id != null ? data.id : "NOK";
        if (statusData.pos && typeof statusData.pos.lng === "string") {
            statusData.pos.lng = parseInt(statusData.pos.lng);
            statusData.pos.lat = parseInt(statusData.pos.lat);
        }
        this.emit("mqtt", { sn, topic, data: statusData, id: id });
        this.absorbLivemapState(meta, statusData);
        if (typeof statusData.event_code === "number") {
            meta.event_code = statusData.event_code;
        }
        if (id === "report_path_change") {
            if (typeof statusData.path_info === "object" && statusData.path_info !== null) {
                meta.path_id_new = statusData.path_info.path_id;
                this.liveMapRequestCheck(sn, statusData, "change");
            }
        }
        //ToDo Use data when the app is open
        if (id === "device_pos" || id === "getPathData") {
            if (meta.livemap) {
                if (id === "getPathData" && statusData.sid === meta.sid) {
                    this.liveMapRequestCheck(sn, statusData, "path");
                }
                if (id === "device_pos") {
                    this.fetchMapWithMqttData(sn).catch((/** @type {{ message: any; }} */ err) =>
                        this.iob.log.debug(`MapMqtt: ${sn}: ${err.message}`),
                    );
                }
            } else {
                if (!meta._refreshTimer) {
                    meta._refreshTimer = this.iob.setTimeout(() => {
                        meta._refreshTimer = null;
                        //this.updateDevice(sn).catch((/** @type {{ message: any; }} */ err) =>
                        //    this.iob.log.debug(`Refresh after MQTT (${sn}): ${err.message}`),
                        //);
                        this.fetchMap(sn).catch((/** @type {{ message: any; }} */ err) =>
                            this.iob.log.debug(`Map ${sn}: ${err.message}`),
                        );
                    }, this.options.refreshAfterMqttMs);
                }
            }
        }
        if (typeof statusData.status === "number") {
            meta.status = statusData.status;
            this.isWorking(sn, statusData);
        }
    },

    /**
     * Update Livemap on/off
     *
     * @param {string} sn
     * @param {boolean} val
     */
    async setLiveMap(sn, val) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            return;
        }
        if (!val) {
            meta.start = 1;
            meta.total = 0;
            meta.work = false;
            meta.work_time = 0;
            meta.pathJsonMqtt = null;
            meta.path_id_old = meta.path_id_new == 0 ? meta.path_id_old : meta.path_id_new;
            meta.path_id_new = 0;
            meta.diff = 4000;
            if (meta._pathCheckTimer) {
                this.iob.clearInterval(meta._pathCheckTimer);
                meta._pathCheckTimer = null;
            }
        } else {
            this.getPathData(sn, meta.sid, 1);
        }
        meta.livemap = val;
    },

    /**
     * @param {string} sn
     * @param {string} sid
     * @param {number} start
     */
    async getPathData(sn, sid, start) {
        await this.getDeviceProperty(sn, {
            id: "getPathData",
            key: "path_data",
            sid: sid,
            start: start,
        });
    },

    /**
     * @param {string} sn
     * @param {any} data
     */
    isWorking(sn, data) {
        this.iob.log.debug(`isWorking: ${JSON.stringify(data)}`);
        const meta = this.deviceMeta[sn];
        if (!meta || meta.sid == "") {
            return;
        }
        let work = false;
        if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
            if (data.status === 2 || data.status === 7 || data.status === 14) {
                work = true;
            }
        }
        if (meta && meta.modelClass === "V") {
            if (data.status === 1 || data.status === 2 || data.status === 14 || data.status === 7) {
                work = true;
            }
        }
        meta.work = work;
        this.iob.log.debug(`work: ${work}`);
        if (!work) {
            meta.start = 1;
            meta.total = 0;
            meta.work_time = 0;
            meta.pathJsonMqtt = null;
            meta.path_id_old = meta.path_id_new == 0 ? meta.path_id_old : meta.path_id_new;
            meta.path_id_new = 0;
            meta.diff = 4000;
            if (meta._pathCheckTimer) {
                this.iob.clearInterval(meta._pathCheckTimer);
                meta._pathCheckTimer = null;
            }
        }
        this.iob.log.debug(`isWorking: ${meta.start} - ${meta.total} - ${meta.work}`);
    },

    /**
     * @param {string} sn
     * @param {any} data
     * @param {"change" | "path"} event
     */
    liveMapRequestCheck(sn, data, event) {
        this.iob.log.debug(`liveMapRequestCheck: ${sn} - ${event} - ${JSON.stringify(data)}`);
        const meta = this.deviceMeta[sn];
        if (!meta || meta.sid == "") {
            return;
        }
        meta.lastUpdate = new Date().getTime();
        if (event === "change") {
            this.getPathData(sn, meta.sid, 1);
            meta.start = 1;
            meta.total = 0;
            this.startPathCheckActive(sn);
            return;
        }
        if (!meta.work) {
            this.iob.log.debug(`Stop Livemap`);
            return;
        }
        if (event === "path") {
            meta.total = data.total;
            const diff = new Date().getTime() - meta.work_time;
            this.iob.log.debug(`Time: ${diff}`);
            meta.work_time = new Date().getTime();
            if (diff < meta.diff) {
                const rt = meta.diff - diff;
                if (!meta._requestTimer) {
                    meta._requestTimer = this.iob.setTimeout(() => {
                        meta._requestTimer = null;
                        this.liveMapHandler(sn, data);
                    }, rt);
                }
            } else {
                this.liveMapHandler(sn, data);
            }
        }
    },

    /**
     * @param {string} sn
     */
    startPathCheckActive(sn) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            return;
        }
        if (meta._pathCheckTimer) {
            meta._pathCheckTimer = this.iob.setInterval(() => {
                this.pathCheck(sn);
            }, 10 * 1000);
        }
    },

    /**
     * @param {string} sn
     */
    pathCheck(sn) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            return;
        }
        if (!meta.work && meta._pathCheckTimer) {
            this.iob.clearInterval(this._pathCheckTimer);
            this._pathCheckTimer = null;
        }
        meta.lastUpdate = new Date().getTime();
        const diff = new Date().getTime() - meta.lastUpdate;
        if (diff > 10000) {
            this.getPathData(sn, meta.sid, meta.start);
        }
    },

    /**
     * @param {string} sn
     * @param {any} data
     */
    async liveMapHandler(sn, data) {
        this.iob.log.debug(`liveMapHandler: ${JSON.stringify(data)}`);
        const meta = this.deviceMeta[sn];
        if (!meta || meta.sid == "") {
            return;
        }
        this.startPathCheckActive(sn);

        const total_diff = data.total - data.start;
        this.iob.log.debug(`total_diff: ${total_diff}`);
        if (data.total > 0 && total_diff < 0 && data.size == 0) {
            meta.start = data.start;
            this.getPathData(sn, meta.sid, meta.start);
            meta.diff = 4000;
            return;
        }
        if (data.total == 0 && data.size == 0) {
            this.getPathData(sn, meta.sid, 1);
            meta.start = 1;
            meta.pathJsonMqtt = null;
            return;
        }
        if (data.total > 0 && data.size == 0 && total_diff > 1) {
            this.getPathData(sn, meta.sid, 1);
            meta.start = 1;
            meta.pathJsonMqtt = null;
            return;
        }
        if ((total_diff > 99 || total_diff == 99) && data.size == 100) {
            meta.start = meta.start + 100;
            meta.diff = 2000;
            this.mergePath(data, meta);
            this.getPathData(sn, meta.sid, meta.start);
            return;
        }
        if (total_diff < 99 && data.size < 100) {
            meta.start = meta.total + 1;
            meta.diff = 4000;
            this.mergePath(data, meta);
            this.getPathData(sn, meta.sid, meta.start);
            return;
        }
    },

    /**
     * @param {any} data
     * @param {{ pathJsonMqtt: string | any[]; total: number; start: any; }} meta
     */
    mergePath(data, meta) {
        try {
            if (typeof data.path === "string") {
                if (data.start == 1 && !meta.pathJsonMqtt) {
                    meta.pathJsonMqtt = JSON.parse(data.path);
                } else {
                    meta.pathJsonMqtt = meta.pathJsonMqtt.concat(JSON.parse(data.path));
                }
                this.iob.log.debug(`MQTT pathJsonMqtt: ${meta.pathJsonMqtt.length}`);
            } else {
                this.iob.log.debug(`MQTT PATH NOT PARSE`);
            }
        } catch (e) {
            this.iob.log.debug(`MQTT PARSE PATH: ${e}`);
        }
    },

    /**
     * Request for device schedule
     *
     * @param {string} sn
     * @param {any} body
     */
    async setDeviceProperty(sn, body) {
        const meta = this.deviceMeta[sn];
        const dev = this.devicesRaw[sn];
        if (!meta || !dev) {
            return;
        }
        let property = "set_property";
        if (dev.modelClass === "V1") {
            property = "setProperty";
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
                `${meta.cmdurl}${property}`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
        } catch (err) {
            this.iob.log.debug(`set_property ${body.id} (${sn}): ${err.message}`);
        }
    },

    /**
     * Request for device properties
     *
     * @param {string} sn
     * @param {any} body
     */
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
        this.iob.log.debug(`getDeviceProperty: ${JSON.stringify(data)}`);
        try {
            await this.request(
                "POST",
                `${meta.cmdurl}get_property`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
        } catch (err) {
            this.iob.log.debug(`get_property ${body.id} (${sn}): ${err.message}`);
        }
    },

    /**
     * @param {string} sn
     */
    async fetchAllProperties(sn) {
        const meta = this.deviceMeta[sn];
        const cls = meta.modelClass;
        if (cls === "V1") {
            return;
        }
        await this.getDeviceProperty(sn, {
            id: "getDevAllProperty",
            key: "all",
        });
        await this.setDeviceProperty(sn, {
            id: "getTimeTactics",
            key: "time_custom",
        });
        if (cls === "S" || cls === "X") {
            await this.getDeviceProperty(sn, {
                id: "getConsumableItems",
                key: "consumable_items",
            });
            await this.setDeviceProperty(sn, {
                id: "getCustom",
                key: "custom",
            });
        }
    },

    async fetchInitialProperties() {
        await this.sleep(9000);
        this._sleepTimer = null;
        const sns = Object.keys(this.deviceMeta);
        this.iob.log.debug(`fetchInitialProperties: ${sns.length} Device(s)`);
        for (const sn of sns) {
            const meta = this.deviceMeta[sn];
            const cls = meta.modelClass;
            if (cls === "V1") {
                continue;
            }
            if (cls === "S" || cls === "X") {
                await this.fetchMap(sn).catch((/** @type {{ message: any; }} */ err) =>
                    this.iob.log.debug(`Map ${sn}: ${err.message}`),
                );
                this.getPathData(sn, meta.sid, 1);
            }
            //if (cls === "S") {
            //    try {
            //        await this.request("GET", "/app_wireless_mower/device-user/getCustomDevice?all=false", {
            //            ...this.authHeaders(),
            //        });
            //    } catch (err) {
            //        this.iob.log.debug(`fetchInitial ${err.message}`);
            //    }
            //}
            //await this.getDeviceProperty(sn, {
            //    id: "getReloStatus",
            //    key: "relo_status",
            //});
            //await this.getDeviceProperty(sn, {
            //    id: "getSupportCustomPatternSet",
            //    key: "support_custom_pattern_set",
            //});
            await this.getDeviceProperty(sn, {
                id: "getDevAllProperty",
                key: "all",
            });
            await this.getDeviceProperty(sn, {
                id: "getSelectRegionID",
                key: "select_regions_id",
            });
            await this.setDeviceProperty(sn, {
                id: "getTimeTactics",
                key: "time_custom",
            });
            if (cls === "S" || cls === "X") {
                const mapid = meta.mapid || 0;
                const mapFile = mapid ? `Wireless_${sn}_${mapid}.json` : `Wireless_${sn}.json`;
                await this.getDeviceProperty(sn, {
                    id: "getAllPath",
                    key: "all_path",
                    map_file: mapFile,
                });
                await this.getDeviceProperty(sn, {
                    id: "getConsumableItems",
                    key: "consumable_items",
                });
                await this.setDeviceProperty(sn, {
                    id: "getCustom",
                    key: "custom",
                });
            }
            if (cls === "V") {
                await this.getDeviceProperty(sn, {
                    id: "getFCState",
                    key: "getfc_state",
                });
            }
        }
    },
    /**
     * Response after approx. 30 seconds
     *
     * @param {string} sn
     */
    getMapTempName(sn) {
        this.getDeviceProperty(sn, {
            id: "getCustom",
            key: "map_temp_name",
        });
    },
};
