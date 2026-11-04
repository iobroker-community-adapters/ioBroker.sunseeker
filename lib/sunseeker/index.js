"use strict";

const { EventEmitter } = require("node:events");

/**
 * Class Sunseeker
 */
class Sunseeker extends EventEmitter {
    /**
     * @param {string} username Sunseeker account email
     * @param {string} password Sunseeker account password
     * @param {object} [options] Sunseeker options
     * @param {string} [options.region] "EU" | "US"
     * @param {string} [options.apptype] "New" | "Old"
     * @param {string} [options.language] e.g. "de-DE"
     * @param {number} [options.interval] poll interval in seconds
     * @param {number} [options.refreshAfterMqttMs] debounce refresh after MQTT push
     * @param {{info:Function,warn:Function,error:Function,debug:Function}} [options.logger] Console
     * @param {ioBroker.Adapter | null} iob iobroker wrapper
     */
    constructor(username, password, options = {}, iob) {
        super();
        this.username = String(username || "");
        this.password = String(password || "");
        this.standalone = iob ? true : false;
        this.iob = iob
            ? iob
            : {
                  setTimeout: (c, t) => setTimeout(c, t),
                  clearTimeout: x => clearTimeout(x),
                  setInterval: (c, t) => setInterval(c, t),
                  clearInterval: x => clearInterval(x),
                  delay: x => this.delay(x),
              };
        this.options = {
            region: String(options.region || "EU").toUpperCase(),
            apptype: options.apptype || "New",
            language: options.language || "en-EN",
            interval: Number(options.interval) > 0 && Number(options.interval) < 1441 ? Number(options.interval) : 360,
            refreshAfterMqttMs: Number(options.refreshAfterMqttMs) > 0 ? Number(options.refreshAfterMqttMs) : 1500,
        };
        this.log = iob
            ? iob.log
            : {
                  info: m => console.log(m),
                  warn: m => console.warn(m),
                  error: m => console.error(m),
                  debug: () => {},
              };
        this.session = null;
        this.devicesRaw = {};
        this.deviceMeta = {};
        this.mqttClient = null;
        this.mqttClientV1 = null;
        this.mqttOldClient = null;
        this.mqttPassword = undefined;
        this.appId = undefined;
        this.topUp = false;
        this.topUpArrayDeviceSn = [];
        this.mqttsPasswordFlag = false;
        this.mqttWirefreeDomain = undefined;
        this.eventCodes = {};
        this.v1EventCodes = {};
        this.devicesId = {};
        this.unloading = false;
        this.statusMqtt = false;
        this.statusMqttV1 = false;
        this.errorCounter = 0;
        this.firstStart = false;
        this.requestLimit = iob
            ? iob.config.request
            : {
                  restartCount: 0,
                  restartLast: 0,
                  restartTime: "",
                  day: "01-01",
              };
        this.maxRequest = iob ? iob.config.ratelimit : 10000;
        this.errorlimit = iob ? iob.config.errorlimit : 20;
        this.livemapSettings = {
            default: {
                region_channel_fill: "rgba(128,128,128,0.35)",
                region_channel_stroke: "rgba(128,128,128,1)",
                region_channel_lineWidth: 1,
                region_channel_active: true,
                region_work_fill: "rgba(34,139,34,1)",
                region_work_stroke: "rgba(0,0,0,1)",
                region_work_lineWidth: 1,
                region_forbidden_fill: "rgba(240,128,128,0.78)",
                region_forbidden_stroke: "rgba(255,0,0,1)",
                region_forbidden_lineWidth: 1,
                region_forbidden_dark_fill: "rgba(240,128,128,0.78)",
                region_forbidden_dark_stroke: "rgba(255,0,0,1)",
                region_forbidden_dark_lineWidth: 1,
                region_forbidden_wall_fill: "rgba(240,128,128,0.78)",
                region_forbidden_wall_stroke: "rgba(255,0,0,1)",
                region_forbidden_wall_lineWidth: 1,
                region_forbidden_active: true,
                region_placed_blank_fill: "rgba(0,0,255,0.59)",
                region_placed_blank_stroke: "rgba(0,0,255,1)",
                region_placed_blank_lineWidth: 1,
                region_placed_blank_active: true,
                region_obstacle_fill: "rgba(128,128,128,0.78)",
                region_obstacle_stroke: "rgba(169,169,169,1)",
                region_obstacle_lineWidth: 2,
                region_obstacle_active: true,
                divide_area_work_stroke: "rgba(0,0,0,1)",
                divide_area_work_lineWidth: 1,
                divide_area_work_active: true,
                polyline_color: "rgba(124,252,0,1)",
                polyline_lineWidth: 1,
                robot_path: "img/robot.png",
                robot_charger_scale: 2,
                charger_path: "img/charger.png",
                region_pattern_active: false,
                region_pattern_lineWidth: 1,
                region_pattern_stroke: "rgba(0, 0, 255,1)",
                region_pattern_fill: "rgba(0, 0, 255,1)",
            },
        };

        this._pollTimer = null;
        this._refreshTimer = null;
        this._refreshTimerOneTime = null;
        this._mqttRetryTimer = null;
        this._mqttRetryTimerV1 = null;
        this._mqttOldRetryTimer = null;
        this._pollFW = null;
        this._sleepTimer = null;
        this._heartbeat = {
            old: null,
            v1: null,
            sxv: null,
        };
        this._heartbeatTimeout = {};
    }

    /**
     * Convenience: load event codes, login, fetch device list, init MQTT, start polling.
     * Caller can also invoke the steps individually.
     */
    async start() {
        if (this.standalone) {
            if (this.iob.config.session.access_token) {
                this.session = this.iob.config.session;
            }
            if (typeof this.iob.config.mqtt_pw === "string" && this.iob.config.mqtt_pw.length > 10) {
                this.mqttPassword = this.iob.config.mqtt_pw;
            }
        }
        this.loadEventCodes(this.options.language);
        if (this.standalone) {
            if (
                this.iob.config.session.action == 0 ||
                !this.iob.config.session ||
                !this.iob.config.session.access_token
            ) {
                this.log.debug(`Start login`);
                await this.login();
            }
            if (this.iob.config.session.action == 1) {
                this.log.debug(`Start refresh`);
                await this.refreshToken().catch(err => this.log.error(`Token-Refresh: ${err.message}`));
            }
        } else {
            await this.login();
        }
        const devices = await this.getDevices();
        if (!Array.isArray(devices)) {
            return null;
        } else if (typeof devices === "object" && devices.length == 0) {
            return null;
        }
        if (this.options.apptype === "New") {
            this.startMqttNew(false);
            this.startMqttNew(true);
        } else {
            this.startMqttOld();
        }
        await this.iob.delay(2000);
        this.startPolling();
        if (this.standalone && this.iob.config.session.action > 1) {
            this.log.debug(`Start refreshOneTime timout - ${this.iob.config.session.action}`);
            this._scheduleTokenRefreshOneTime();
        } else {
            this.log.debug(`Start refresh interval`);
            this._scheduleTokenRefresh();
        }
        return true;
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
        if (this._sleepTimer) {
            this.iob.clearTimeout(this._sleepTimer);
            this._sleepTimer = null;
        }
        if (this._refreshTimerOneTime) {
            this.iob.clearTimeout(this._refreshTimerOneTime);
            this._refreshTimerOneTime = null;
        }
        if (this._mqttRetryTimer) {
            this.iob.clearTimeout(this._mqttRetryTimer);
            this._mqttRetryTimer = null;
        }
        if (this._mqttRetryTimerV1) {
            this.iob.clearTimeout(this._mqttRetryTimerV1);
            this._mqttRetryTimerV1 = null;
        }
        if (this._mqttOldRetryTimer) {
            this.iob.clearTimeout(this._mqttOldRetryTimer);
            this._mqttOldRetryTimer = null;
        }
        if (this._pollFW) {
            this.iob.clearInterval(this._pollFW);
            this._pollFW = null;
        }
        for (const hb in this._heartbeat) {
            if (this._heartbeat[hb]) {
                this.iob.clearInterval(this._heartbeat[hb]);
                this._heartbeat[hb] = null;
            }
        }
        for (const hb in this._heartbeatTimeout) {
            if (this._heartbeatTimeout[hb]) {
                this.iob.clearTimeout(this._heartbeatTimeout[hb]);
                this._heartbeatTimeout[hb] = null;
            }
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
        for (const client of [this.mqttClient, this.mqttClientV1, this.mqttOldClient]) {
            if (client) {
                try {
                    client.end(true);
                } catch (e) {
                    this.log.debug(`mqtt and error: ${e.message}`);
                }
            }
        }
        this.mqttClient = null;
        this.mqttOldClient = null;
        this.mqttClientV1 = null;
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
    require("./mqttV1"),
    require("./map"),
    require("./map_preview"),
    require("./helper"),
);

module.exports = Sunseeker;
