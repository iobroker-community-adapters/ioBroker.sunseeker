"use strict";

const crypto = require("node:crypto");
const mqtt = require("mqtt");

const { APP_ID } = require("./auth");

const MQTT_OLD_HOST = "mqtts.sk-robot.com";
const MQTT_OLD_PORT = 1883;
const MQTT_OLD_USER = "app";
const MQTT_OLD_PASS = "h4ijwkTnyrA";

module.exports = {
    /** Dispatch by apptype: New (S/X/V/V1 brokers) vs. Old (legacy broker). */
    initMqtt() {
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
            await this.editMqttPassword();
        } catch (err) {
            this.log.error(`MQTT-Passwort setzen fehlgeschlagen: ${err.message}`);
            this.emit("error", err);
            return;
        }
        if (this.unloading) {
            return;
        }
        this.connectMqtt();
    },

    connectMqtt() {
        if (!this.session?.access_token) {
            this.emit("error", new Error("connectMqtt: keine aktive Session"));
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
        const username = `${this.session.username || this.username}${APP_ID}`;
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
            this.emit("mqttConnect");
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
            if (this.mqttClient !== client) {
                return;
            }
            this.log.warn(`MQTT error: ${err.message}`);
            const code = /** @type {any} */ (err).code;
            if (code === 4 || code === 5 || /not authorized|bad user/i.test(err.message)) {
                this.scheduleMqttRetry();
            }
        });

        client.on("close", () => {
            if (this.mqttClient !== client) {
                return;
            }
            this.log.debug("MQTT geschlossen");
            this.emit("mqttDisconnect");
            if (!this.unloading) {
                this.scheduleMqttRetry();
            }
        });
    },

    scheduleMqttRetry() {
        if (this.unloading || this._mqttRetryTimer) {
            return;
        }
        this._mqttRetryTimer = setTimeout(() => {
            this._mqttRetryTimer = null;
            this.startMqttNew().catch(err => this.log.error(`MQTT-Reconnect: ${err.message}`));
        }, 30000);
        this._mqttRetryTimer.unref?.();
    },

    startMqttOld() {
        if (this.unloading) {
            return;
        }
        if (!this.session?.user_id) {
            this.emit("error", new Error("startMqttOld: keine aktive Session"));
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
            this.emit("mqttConnect");
            const topic = `/app/${userId}/get`;
            client.subscribe(topic, { qos: 0 }, err => {
                if (err) {
                    this.log.error(`MQTT (Old) subscribe ${topic}: ${err.message}`);
                }
            });
        });
        client.on("message", (topic, payload) => this.onMqttMessage(topic, payload));
        client.on("error", err => {
            if (this.mqttOldClient !== client) {
                return;
            }
            this.log.warn(`MQTT (Old) error: ${err.message}`);
        });
        client.on("close", () => {
            if (this.mqttOldClient !== client) {
                return;
            }
            this.log.debug("MQTT (Old) geschlossen");
            this.emit("mqttDisconnect");
            if (!this.unloading && !this._mqttOldRetryTimer) {
                this._mqttOldRetryTimer = setTimeout(() => {
                    this._mqttOldRetryTimer = null;
                    this.startMqttOld();
                }, 30000);
                this._mqttOldRetryTimer.unref?.();
            }
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
        const pathInfo = statusData.path_info;
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
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    meta.livePath.push([x, y]);
                }
            }
            if (meta.livePath.length > 5000) {
                meta.livePath.splice(0, meta.livePath.length - 5000);
            }
        }
    },

    onMqttMessage(topic, payload) {
        let data;
        try {
            data = JSON.parse(payload.toString("utf8"));
        } catch {
            this.log.debug(`MQTT non-JSON: ${payload.toString("utf8").slice(0, 200)}`);
            return;
        }
        if (!data || typeof data !== "object") {
            return;
        }
        const sn = data.deviceSn;
        if (!sn || !this.devicesRaw[sn]) {
            this.log.debug(`MQTT für unbekanntes Gerät: ${topic} ${JSON.stringify(data).slice(0, 120)}`);
            return;
        }
        this.log.debug(`MQTT ${sn} ${topic}: ${JSON.stringify(data).length} Bytes`);
        const statusData = data.data && typeof data.data === "object" ? data.data : data;
        this.emit("mqtt", { sn, topic, data: statusData });
        const meta = this.deviceMeta[sn];
        this.absorbLivemapState(meta, statusData);
        if (meta._refreshTimer) {
            clearTimeout(meta._refreshTimer);
        }
        meta._refreshTimer = setTimeout(() => {
            meta._refreshTimer = null;
            this.updateDevice(sn).catch(err => this.log.debug(`Refresh nach MQTT (${sn}): ${err.message}`));
        }, this.options.refreshAfterMqttMs);
        meta._refreshTimer.unref?.();
    },

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
    },

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
    },
};
