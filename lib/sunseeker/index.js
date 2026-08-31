"use strict";

const { EventEmitter } = require("node:events");

/**
 * Class Sunseeker
 */
class Sunseeker extends EventEmitter {
    /**
     * @param {string} username Sunseeker account email
     * @param {string} password Sunseeker account password
     * @param {ioBroker.Adapter} iob iobroker wrapper
     * @param {object} [options]
     * @param {string} [options.region] "EU" | "US"
     * @param {string} [options.apptype] "New" | "Old"
     * @param {string} [options.language] e.g. "de-DE"
     * @param {number} [options.interval] poll interval in seconds
     * @param {number} [options.refreshAfterMqttMs] debounce refresh after MQTT push
     */
    constructor(username, password, iob, options = {}) {
        super();
        this.username = String(username || "");
        this.password = String(password || "");
        this.iob = iob;
        this.options = {
            region: String(options.region || "EU").toUpperCase(),
            apptype: options.apptype || "New",
            language: options.language || "en-EN",
            interval: Number(options.interval) > 0 ? Number(options.interval) : 60,
            refreshAfterMqttMs: Number(options.refreshAfterMqttMs) > 0 ? Number(options.refreshAfterMqttMs) : 1500,
        };

        if (!this.iob) {
            throw new Error("Missing ioBroker function!!!");
        }

        this.session = null;
        this.devicesRaw = {};
        this.deviceMeta = {};
        this.mqttClient = null;
        this.mqttOldClient = null;
        this.mqttPassword = undefined;
        this.appId = undefined;
        this.mqttsPasswordFlag = false;
        this.mqttWirefreeDomain = undefined;
        this.eventCodes = {};
        this.v1EventCodes = {};
        this.unloading = false;
        this.statusMqtt = false;
        this.errorCounter = 0;
        this.firstStart = false;
        this.requestLimit = iob.config.request;
        this.maxRequest = iob.config.ratelimit;
        this.livemapSettings = {
            default: {
                region_channel_fill: "rgba(128,128,128,0.35)",
                region_channel_stroke: "rgba(128,128,128,1)",
                region_channel_lineWidth: 1,
                region_work_fill: "rgba(34,139,34,1)",
                region_work_stroke: "rgba(0,0,0,1)",
                region_work_lineWidth: 1,
                region_forbidden_fill: "rgba(240,128,128,0.78)",
                region_forbidden_stroke: "rgba(255,0,0,1)",
                region_forbidden_lineWidth: 1,
                region_placed_blank_fill: "rgba(0,0,255,0.59)",
                region_placed_blank_stroke: "rgba(0,0,255,1)",
                region_placed_blank_lineWidth: 1,
                region_obstacle_fill: "rgba(128,128,128,0.78)",
                region_obstacle_stroke: "rgba(169,169,169,1)",
                region_obstacle_lineWidth: 2,
                divide_area_work_stroke: "rgba(0,0,0,1)",
                divide_area_work_lineWidth: 1,
                polyline_color: "rgba(124,252,0,1)",
                polyline_lineWidth: 1,
                robot_path: "img/robot.png",
                robot_charger_scale: 2,
                charger_path: "img/charger.png",
            },
        };

        this._pollTimer = null;
        this._refreshTimer = null;
        this._refreshTimerOneTime = null;
        this._mqttRetryTimer = null;
        this._mqttOldRetryTimer = null;
        this._pollFW = null;
        this._sleepTimer = null;
    }

    /**
     * Convenience: load event codes, login, fetch device list, init MQTT, start polling.
     * Caller can also invoke the steps individually.
     */
    async start() {
        if (this.iob.config.session.access_token) {
            this.session = this.iob.config.session;
        }
        if (typeof this.iob.config.mqtt_pw === "string" && this.iob.config.mqtt_pw.length > 10) {
            this.mqttPassword = this.iob.config.mqtt_pw;
        }
        this.loadEventCodes(this.options.language);
        if (this.iob.config.session.action == 0 || !this.iob.config.session) {
            this.iob.log.debug(`Start login`);
            await this.login();
        }
        if (this.iob.config.session.action == 1) {
            this.iob.log.debug(`Start refresh`);
            await this.refreshToken().catch(err => this.iob.log.error(`Token-Refresh: ${err.message}`));
        }
        await this.getDevices();
        if (this.options.apptype === "New") {
            this.startMqttNew();
        } else {
            this.startMqttOld();
        }
        await this.sleep(2000);
        this.startPolling();
        if (this.iob.config.session.action > 1) {
            this.iob.log.debug(`Start refreshOneTime timout - ${this.iob.config.session.action}`);
            this._scheduleTokenRefreshOneTime();
        } else {
            this.iob.log.debug(`Start refresh interval`);
            this._scheduleTokenRefresh();
        }
    }

    /**
     * Stop all pollings.
     */
    stop() {
        this.unloading = true;
        if (this._pollTimer) {
            this.iob.clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        if (this._refreshTimer) {
            this.iob.clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._refreshTimerOneTime) {
            this.iob.clearTimeout(this._refreshTimerOneTime);
            this._refreshTimerOneTime = null;
        }
        if (this._mqttRetryTimer) {
            this.iob.clearTimeout(this._mqttRetryTimer);
            this._mqttRetryTimer = null;
        }
        if (this._sleepTimer) {
            this.iob.clearTimeout(this._sleepTimer);
            this._sleepTimer = null;
        }
        if (this._mqttOldRetryTimer) {
            this.iob.clearTimeout(this._mqttOldRetryTimer);
            this._mqttOldRetryTimer = null;
        }
        if (this._pollFW) {
            this.iob.clearInterval(this._pollFW);
            this._pollFW = null;
        }
        for (const meta of Object.values(this.deviceMeta)) {
            if (meta._refreshTimer) {
                this.iob.clearTimeout(meta._refreshTimer);
                meta._refreshTimer = null;
            }
            if (meta._requestTimer) {
                this.iob.clearTimeout(meta._requestTimer);
                meta._requestTimer = null;
            }
            if (meta._pathCheckTimer) {
                this.iob.clearInterval(this._pathCheckTimer);
                this._pathCheckTimer = null;
            }
            meta.livePath = [];
            meta.robotPos = null;
            meta.chargerPos = null;
        }
        for (const client of [this.mqttClient, this.mqttOldClient]) {
            if (client) {
                try {
                    client.end(true);
                } catch (e) {
                    this.iob.log.debug(`mqtt and error: ${e.message}`);
                }
            }
        }
        this.mqttClient = null;
        this.mqttOldClient = null;
    }

    /**
     * @param {string} modelClass "S" | "X" | "V" | "V1"
     * @returns {Record<string,string>} event-code → label map for the device class
     */
    getEventCodes(modelClass) {
        return modelClass === "V1" || this.options.apptype === "Old" ? this.v1EventCodes : this.eventCodes;
    }
}

Object.assign(
    Sunseeker.prototype,
    require("./auth"),
    require("./devices"),
    require("./polling-and-settings"),
    require("./mqtt"),
    require("./map"),
    require("./helper"),
);

module.exports = Sunseeker;
