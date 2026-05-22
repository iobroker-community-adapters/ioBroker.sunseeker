"use strict";

const NEW_ACTIONS = {
    start: { cmd: "start", cmdid: "startWork" },
    pause: { cmd: "pause", cmdid: "pauseWork" },
    dock: { cmd: "start_find_charger", cmdid: "startFindCharger" },
    stop_find_charger: { cmd: "stop_find_charger", cmdid: "stopFindCharger" },
    border: { cmd: "follow_border", cmdid: "followBorder" },
    stop: { cmd: "stop", cmdid: "stopWork" },
    stop_task: { cmd: "stop_task", cmdid: "stopTask" },
    restart: { cmd: "restart", cmdid: "restartWork" },
};

const OLD_MODES = { start: 1, pause: 0, dock: 2, border: 4, stop: 4 };
const V1_MODES = { start: 1, pause: 0, dock: 2, border: 4, stop: 4 };

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

module.exports = {
    /**
     * Start the periodic poll loop. Replaces any previous timer.
     */
    startPolling() {
        this.stopPolling();
        const intervalMs = this.options.interval * 1000;
        this._pollTimer = setInterval(() => {
            this.updateAllDevices().catch(err => this.log.warn(`Polling: ${err.message}`));
        }, intervalMs);
        this._pollTimer.unref?.();
    },

    stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    async updateAllDevices() {
        const sns = Object.keys(this.devicesRaw);
        this.log.debug(`updateAllDevices: ${sns.length} Gerät(e)`);
        for (const sn of sns) {
            try {
                await this.updateDevice(sn);
            } catch (err) {
                this.log.warn(`Update ${sn}: ${err.message}`);
            }
        }
    },

    /**
     * Fetch status + settings for one device. Emits a single 'status' event
     * with both payloads as separate fields. For New-API S/X devices this
     * also triggers a fetchMap (which emits its own 'map'/'livemap' events).
     */
    async updateDevice(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        this.log.debug(`updateDevice ${sn}: Status + Einstellungen abrufen`);
        const statusPath =
            this.options.apptype === "Old"
                ? `/mower/device/getBysn?sn=${encodeURIComponent(sn)}`
                : `/app_wireless_mower/device/getBysn?sn=${encodeURIComponent(sn)}`;
        const settingsPath =
            this.options.apptype === "Old"
                ? `/mower/device-setting/${encodeURIComponent(sn)}`
                : `/app_wireless_mower/device-setting/${encodeURIComponent(sn)}`;

        const status = await this.request("GET", statusPath, this.authHeaders());
        const settings = await this.request("GET", settingsPath, this.authHeaders());

        const statusData = status.json && status.json.data ? status.json.data : null;
        const settingsData = settings.json && settings.json.data ? settings.json.data : null;
        this.emit("status", { sn, status: statusData, settings: settingsData });

        if (this.options.apptype !== "Old") {
            const meta = this.deviceMeta[sn];
            if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                await this.fetchMap(sn).catch(err => this.log.debug(`Map ${sn}: ${err.message}`));
            }
        }
    },

    async sendCommand(sn, command, value) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        if (this.options.apptype === "Old") {
            return this.sendCommandOld(dev, command);
        }
        if (meta.modelClass === "V1") {
            return this.sendCommandV1(dev, meta, command);
        }
        return this.sendCommandNew(dev, meta, command, value);
    },

    async sendCommandNew(dev, meta, command, value) {
        const action = NEW_ACTIONS[command];
        if (!action) {
            throw new Error(`Unbekannter Befehl: ${command}`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            cmd: action.cmd,
            deviceSn: dev.deviceSn,
            id: action.cmdid,
            method: "action",
        };
        if (command === "border" && meta.modelClass === "V") {
            data.value = true;
        }
        if (command === "start" && value && typeof value !== "boolean") {
            data.work_id = value;
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}action`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    },

    async sendCommandV1(dev, meta, command) {
        const mode = V1_MODES[command];
        if (mode === undefined) {
            throw new Error(`V1: Befehl ${command} nicht unterstützt`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            method: "setWorkStatus",
            mode,
        };
        const res = await this.request(
            "POST",
            `${meta.cmdurl}setProperty`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    },

    async sendCommandOld(dev, command) {
        const mode = OLD_MODES[command];
        if (mode === undefined) {
            throw new Error(`Old: Befehl ${command} nicht unterstützt`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            mode,
        };
        const res = await this.request(
            "POST",
            "/app_mower/device/setWorkStatus",
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    },

    /**
     * @param {string} sn
     * @param {"speed"|"height"} key
     * @param {number} value
     */
    async setBlade(sn, key, value) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        if (this.options.apptype === "Old") {
            throw new Error("Klingen-Steuerung wird für Alt-API nicht unterstützt");
        }
        const intVal = Math.round(Number(value));
        if (!Number.isFinite(intVal)) {
            throw new Error(`Ungültiger Wert: ${value}`);
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            id: "setDevBlade",
            key: "blade",
            method: "set_property",
            [key]: intVal,
        };
        const endpoint = meta.modelClass === "V1" ? "setProperty" : "set_property";
        const res = await this.request(
            "POST",
            `${meta.cmdurl}${endpoint}`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    },

    /**
     * @param {string} sn
     * @param {boolean} flag
     * @param {number} durationMin
     */
    async setRain(sn, flag, durationMin) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        const duration = Math.max(0, Math.min(720, Math.round(Number(durationMin))));
        const appId = String(dev.appUserId || this.session.user_id);

        if (this.options.apptype === "Old") {
            const res = await this.request(
                "POST",
                `/app_mower/device/setRain/${encodeURIComponent(sn)}/${appId}`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    rainDelayDuration: duration,
                    rainFlag: flag,
                }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        if (meta.modelClass === "V1") {
            const res = await this.request(
                "POST",
                `${meta.cmdurl}setProperty`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    method: "setRain",
                    rainDelayDuration: duration,
                    rainFlag: flag,
                }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        const res = await this.request(
            "POST",
            `${meta.cmdurl}set_property`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify({
                appId,
                deviceSn: sn,
                id: "setDevRain",
                key: "rain",
                method: "set_property",
                rain_flag: flag,
                delay: duration,
            }),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    },

    /**
     * @param {string} value e.g. "08:00-12:00", empty string means off
     * @returns {{startSec: number, endSec: number} | null}
     */
    parseScheduleDay(value) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
            return null;
        }
        const m = trimmed.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!m) {
            throw new Error(`Format "HH:MM-HH:MM" erwartet, war: "${trimmed}"`);
        }
        const sh = Number(m[1]);
        const sm = Number(m[2]);
        const eh = Number(m[3]);
        const em = Number(m[4]);
        if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
            throw new Error(`Ungültige Uhrzeit: "${trimmed}"`);
        }
        return { startSec: sh * 3600 + sm * 60, endSec: eh * 3600 + em * 60 };
    },

    /**
     * @param {number} sec
     */
    secToHms(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    },

    /**
     * @param {string} sn
     * @param {Record<string, any>} plan
     *   plan.monday..plan.sunday: "HH:MM-HH:MM" string (empty = day off)
     *   plan.pause: boolean (default false) — pause whole schedule
     */
    async setSchedule(sn, plan) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            throw new Error(`Gerät ${sn} unbekannt`);
        }
        const safePlan = plan && typeof plan === "object" ? plan : {};
        const parsed = DAYS.map((key, i) => ({
            dayIndex: i + 1,
            key,
            window: this.parseScheduleDay(safePlan[key]),
        }));
        const pause = !!safePlan.pause;
        const appId = String(dev.appUserId || this.session.user_id);

        if (this.options.apptype === "Old") {
            const bos = parsed.map(p => ({
                dayOfWeek: p.dayIndex,
                startAt: p.window ? this.secToHms(p.window.startSec) : "00:00:00",
                endAt: p.window ? this.secToHms(p.window.endSec) : "00:00:00",
                trimFlag: !!p.window,
            }));
            const res = await this.request(
                "POST",
                "/app_mower/device-schedule/setScheduling",
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({ appId, autoFlag: !pause, deviceScheduleBOS: bos, deviceSn: sn }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        if (meta.modelClass === "V1") {
            const bos = [];
            for (const p of parsed) {
                if (!p.window) {
                    continue;
                }
                bos.push({
                    dayOfWeek: p.dayIndex,
                    startAt: this.secToHms(p.window.startSec),
                    endAt: this.secToHms(p.window.endSec),
                    trimFlag: true,
                });
            }
            const res = await this.request(
                "POST",
                `${meta.cmdurl}setProperty`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    autoFlag: !pause,
                    method: "setSchedule",
                    deviceScheduleBOS: bos,
                    pause,
                }),
            );
            if (res.json && res.json.ok === false) {
                throw new Error(`API: ${res.json.msg}`);
            }
            return;
        }

        // S/X/V — set_property time_tactics. Mon=1..Sat=6, Sun=0
        const dayPeriod = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
        const time = [];
        for (const p of parsed) {
            if (!p.window) {
                continue;
            }
            time.push({
                unlock: true,
                period: [dayPeriod[p.key]],
                start: p.window.startSec,
                active: true,
                end: p.window.endSec,
                need_fllow_boader: false,
            });
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}set_property`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify({
                appId,
                deviceSn: sn,
                id: "setTimeTactics",
                key: "time_tactics",
                method: "set_property",
                time,
                time_custom_flag: true,
                recommended_time_flag: false,
                time_zone: 3600,
                pause,
            }),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`API: ${res.json.msg}`);
        }
    },
};

module.exports.NEW_ACTIONS = NEW_ACTIONS;
module.exports.OLD_MODES = OLD_MODES;
module.exports.V1_MODES = V1_MODES;
module.exports.DAYS = DAYS;
