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
    backup_delete_active: { cmd: "delete_backup_map", cmdid: "deleteBackupMap", amount: 1 },
    backup_delete: { cmd: "delete_backup_map", cmdid: "deleteBackupMap", amount: 2 },
    backup_map: { cmd: "backup_map", cmdid: "backupMap", amount: 3 },
    used: { cmd: "restore_map", cmdid: "restoreMap" },
    reset_small_bladeplate: { cmd: "maintain_consumable_item", cmdid: "maintainConsumableItem" },
    reset_small_blade: { cmd: "maintain_consumable_item", cmdid: "maintainConsumableItem" },
    reset_bladeplate: { cmd: "maintain_consumable_item", cmdid: "maintainConsumableItem" },
    reset_blade: { cmd: "maintain_consumable_item", cmdid: "maintainConsumableItem" },
    merge_zones: { cmd: "merge_region", cmdid: "mergeRegion" },
    split_zones: { cmd: "split_region", cmdid: "splitRegion" },
    passages: { cmd: "draw_passage", cmdid: "drawPassage" },
};

const OLD_MODES = { start: 1, pause: 0, dock: 2, border: 4, stop: 4 };
const V1_MODES = { start: 1, pause: 0, dock: 2, border: 4, stop: 4 };
const V1_ACTION = {
    start: { method: "setWorkStatus", val: "start" },
    pause: { method: "setWorkStatus", val: "pause" },
    dock: { method: "setWorkStatus", val: "dock" },
    border: { method: "setWorkStatus", val: "border" },
    stop: { method: "setWorkStatus", val: "stop" },
    set_return_path: { method: "setReturnMode", val: "returnMode" },
    set_screen_duration: { method: "setDuration", val: "duration" },
    set_border_first: { method: "setRideMode", val: "rideMode" },
    set_border_distance: { method: "setLv", val: "lv" },
    set_workmode: { method: "setWorkStatus", val: "mode" },
    set_schedule_on_off: { method: "setPause", val: "Pause" },
};

const DAYS = ["1_monday", "2_tuesday", "3_wednesday", "4_thursday", "5_friday", "6_saturday", "0_sunday"];

module.exports = {
    /**
     * Start the periodic poll loop. Replaces any previous timer.
     */
    startPolling() {
        this.stopPolling();
        const intervalMs = this.options.interval * 60 * 1000;
        this._pollTimer = this.iob.setInterval(async () => {
            await this.requestLimitCheck();
            this.updateAllDevices(true).catch(err => this.emit("error", "Polling", err));
        }, intervalMs);
        if (this.options.apptype !== "Old") {
            this.startUpdateCheck(true);
            this.startUpdateCheckInterval();
        }
    },

    stopPolling() {
        if (this._pollTimer) {
            this.iob.clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    startUpdateCheckInterval() {
        this._pollFW = this.iob.setInterval(
            () => {
                this.errorCounter = 0;
                this.startUpdateCheck(false);
            },
            60 * 60 * 1000 * 24,
        );
    },

    /**
     * @param {boolean} first
     */
    async startUpdateCheck(first) {
        if (first) {
            // Create the objects first
            await this.iob.delay(12000);
        }
        const sns = Object.keys(this.devicesRaw);
        for (const sn of sns) {
            const meta = this.deviceMeta[sn];
            this.log.debug(meta.fw);
            let deviceSpecies = 3;
            const deviceType = 0;
            if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                deviceSpecies = 0;
                this.getWifi(sn);
            }
            const data = {
                deviceSn: sn,
                deviceSpecies: deviceSpecies,
                deviceType: deviceType,
                version: meta.fw,
            };
            const res = await this.request(
                "POST",
                "/ota/firmware-large/wireless/check",
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
            if (res.json && res.json.ok === false) {
                this.log.error(`API: ${res.json.msg}`);
            } else {
                this.log.debug(`startUpdateCheck: ${JSON.stringify(res.json)}`);
                let version = meta.fw;
                // ToDo added Base Firmware
                if (deviceType == 0) {
                    if (deviceSpecies == 3) {
                        if (
                            res.json.data &&
                            (typeof res.json.data.version == "string" || typeof res.json.data.version == "number")
                        ) {
                            version = res.json.data.version;
                        }
                    } else {
                        if (
                            res.json.data &&
                            (typeof res.json.data.wirelessVersion == "string" ||
                                typeof res.json.data.wirelessVersion == "number")
                        ) {
                            version = res.json.data.wirelessVersion;
                        }
                    }
                }
                let desc = "";
                if (res.json.data && typeof res.json.data.description == "string") {
                    desc = res.json.data.description;
                } else if (res.json.data && typeof res.json.data.currentVersionDesc == "string") {
                    desc = res.json.data.currentVersionDesc;
                }
                let update = false;
                if (this.compareVersions(version, meta.fw)) {
                    update = true;
                }
                meta.fw_new = version;
                if (typeof version == "number") {
                    version = version.toString();
                }
                this.emit("firmware", { sn: sn, fw: version, update: update, desc: desc });
            }
        }
    },

    /**
     * @param {string} v1
     * @param {string} v2
     * @returns {boolean}
     */
    compareVersions(v1, v2) {
        const a = v1.split(".").map(Number);
        const b = v2.split(".").map(Number);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const numA = a[i] || 0;
            const numB = b[i] || 0;
            if (numA > numB) {
                return true;
            }
            if (numA < numB) {
                return false;
            }
        }
        return false;
    },

    /**
     * @param {string | number} sn
     */
    setProfile(sn) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        if (meta.modelClass === "S" || meta.modelClass === "X") {
            meta.profile = true;
        }
    },

    /**
     * @param {string} sn
     */
    async ota_upgrade(sn) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        if (this.compareVersions(meta.fw_new, meta.fw)) {
            const data = {
                appId: String(dev.appUserId || this.session.user_id),
                deviceSn: sn,
                deviceType: 0,
                id: "upgradeOTA",
                method: "upgrade",
                mode: "1",
            };
            const cmd = "otaUpgrade";
            const url = `${meta.cmdurl}${cmd}`;
            const res = await this.request(
                "POST",
                url,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
            if (res.json && res.json.ok === false) {
                this.log.error(`API: ${res.json.msg}`);
            } else {
                this.log.debug(`ota_upgrade: ${JSON.stringify(res.json)}`);
                const meta = this.deviceMeta[sn];
                meta.fw = meta.fw_new;
                this.startUpdateCheck(false);
            }
        } else {
            this.log.warn(`No update found!`);
        }
    },

    /**
     * @param {string} sn
     */
    async ota_base_upgrade(sn) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        if (this.compareVersions(meta.fw_base_new, meta.fw_base)) {
            const data = {
                appId: String(dev.appUserId || this.session.user_id),
                deviceSn: sn,
                deviceType: 2,
                id: "baseStationOTA",
                method: "upgrade",
            };
            const cmd = "otaUpgrade";
            const url = `${meta.cmdurl}${cmd}`;
            const res = await this.request(
                "POST",
                url,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
            if (res.json && res.json.ok === false) {
                this.log.error(`API: ${res.json.msg}`);
            } else {
                this.log.debug(`ota_base_upgrade: ${JSON.stringify(res.json)}`);
                const meta = this.deviceMeta[sn];
                meta.fw = meta.fw_new;
                this.startUpdateCheck(false);
            }
        } else {
            this.log.warn(`No update found!`);
        }
    },

    /**
     * @param {boolean} first
     */
    async updateAllDevices(first) {
        const sns = Object.keys(this.devicesRaw);
        this.log.debug(`updateAllDevices: ${sns.length} Device(s)`);
        if (first) {
            await this.getUpdateDevices();
            await this.getUpdateSharing();
        }
        for (const sn of sns) {
            try {
                await this.updateDevice(sn);
                await this.getNotice(sn);
                if ((this.statusMqtt || this.statusMqttV1) && this.firstStart) {
                    this.fetchAllProperties(sn).catch(err => this.emit("error", `Initial-Properties`, err));
                }
            } catch (err) {
                this.emit("error", `Update ${sn}`, err);
            }
        }
        this.firstStart = true;
    },

    /**
     * @param {string} sn
     * @param {any} data
     */
    async setNotice(sn, data) {
        this.log.debug(`setNotice: ${sn} - ${JSON.stringify(data)}`);
        const res = await this.request(
            "POST",
            "/app_mower/notice-control",
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API-setNotice: ${res.json.msg}`);
        } else {
            this.log.debug(`setNotice: ${JSON.stringify(res.json)}`);
        }
    },

    /**
     * @param {string} sn
     */
    async getNotice(sn) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        this.log.debug(`notice ${sn}: Retrieve Notice-Control`);
        const notice = await this.request("GET", "/app_mower/notice-control", this.authHeaders());
        if (notice == "Timeout" || notice == "Ratelimit") {
            return;
        }
        this.log.debug(`notice: ${JSON.stringify(notice)}`);
        if (notice && notice.json && notice.json.data) {
            this.emit("notice", { sn, notice: notice.json.data });
        }
    },

    /**
     * Fetch status + settings for one device. Emits a single 'status' event
     * with both payloads as separate fields. For New-API S/X devices this
     * also triggers a fetchMap (which emits its own 'map'/'livemap' events).
     *
     * @param {string} sn
     */
    async updateDevice(sn) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        this.log.debug(`updateDevice ${sn}: Retrieve Status + Settings`);
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

        if (statusData == "Timeout" || statusData == "Ratelimit") {
            return;
        }
        if (settingsData == "Timeout" || settingsData == "Ratelimit") {
            return;
        }
        this.log.debug(`statusData: ${JSON.stringify(statusData)}`);
        if (statusData) {
            if (statusData.onlineFlag != null) {
                dev.online = statusData.onlineFlag;
            } else if (statusData.online != null) {
                dev.online = statusData.online;
            }
            this.changeAttributeName(statusData);
        }
        if (settingsData) {
            this.changeAttributeName(settingsData);
        }
        this.log.debug(`settingsData: ${JSON.stringify(settingsData)}`);
        meta.share = settingsData.shareableFlag ? true : false;
        this.emit("status", { sn, status: statusData, settings: settingsData });
        if (this.options.apptype === "New") {
            await this.getEvents(sn, 1, 10);
        }
        if (this.options.apptype !== "Old") {
            if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                await this.fetchMap(sn).catch(err => this.emit("error", `Map ${sn}`, err));
                if (meta.share) {
                    await this.getSharingUser(sn, dev.deviceId);
                }
            }
        }
        if (meta.modelClass === "S" || meta.modelClass === "X") {
            this.log.debug(`${sn}: Create objects for the zones, then custom-multi-angle`);
            await this.getInfo(sn);
        }
        if (meta.antiTheftSn && typeof meta.antiTheftSn === "string" && meta.antiTheftSn.length > 0) {
            await this.updateTheft(sn);
        }
    },
    /**
     * @param {string} sn
     * @param {string} id
     * @return {Promise<boolean>}
     */
    async getSharingUser(sn, id) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const res = await this.request("GET", `/app_wireless_mower/device-user/device/${id}/list`, {
            ...this.authHeaders(),
            "Content-Type": "application/json",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API sharing: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getSharingUser: ${JSON.stringify(res.json)}`);
        this.emit("sharing", sn, res.json.data);
        return true;
    },
    /**
     * @param {number} type -1 to -115
     * @param {string} model e.g. S4
     * @param {any} base e.g. 0
     */
    async getHelp(type, model, base) {
        await this.iob.delay(1000);
        const apiPath = encodeURIComponent(
            `/app_wireless_mower/device/notice/pic/info?type=error&detailType=${type}&clientModel=${model}&nrtkBase=${base}`,
        );
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json",
        });
        this.log.debug(`getHelp: ${JSON.stringify(res)}`);
        return res ? res.json : null;
    },
    /**
     * @param {string} sn
     */
    async updateTheft(sn) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        if (meta.antiTheftSn && typeof meta.antiTheftSn === "string" && meta.antiTheftSn.length > 0) {
            await this.getAntiTheftX(sn, "pos");
            await this.getAntiTheftX(sn, "theft");
        }
    },
    /**
     * @param {string} sn
     * @return {Promise<boolean>}
     */
    async setMarkAllAsRead(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const data = { userId: String(dev.appUserId || this.session.user_id), sn: sn, type: 2 };
        const res = await this.request(
            "PUT",
            `/app_wireless_mower/message-send-logs/batchread`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API unread: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setMarkAllAsRead: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {any} data
     * @return {Promise<boolean>}
     */
    async setAntiTheftX(data) {
        const apiPath = `/gps/mobile/anti-theft/set-fence`;
        const res = await this.request(
            "POST",
            apiPath,
            { ...this.authHeaders(), "Content-Type": "application/json; charset=UTF-8" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API AntiTheft: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setAntiTheftX: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} sn
     * @param {string} request
     */
    async getAntiTheftX(sn, request) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        let apiPath = "";
        if (request == "list") {
            apiPath = `/gps/fence-radius-setting/list`;
            const list = await this.request("GET", apiPath, {
                ...this.authHeaders(),
                "Content-Type": "application/json; charset=UTF-8",
            });
            if (list.json && list.json.ok === false) {
                this.log.error(`API List: ${list.json.msg}`);
            } else {
                this.log.debug(`list: ${JSON.stringify(list.json)}`);
                await this.createFence(sn);
                this.emit("fence", { sn, fence: list.json.data });
            }
        }
        if (request == "pos") {
            apiPath = `/gps/mobile/anti-theft/device-position/${meta.antiTheftSn}`;
            const pos = await this.request("GET", apiPath, {
                ...this.authHeaders(),
                "Content-Type": "application/json; charset=UTF-8",
            });
            if (pos.json && pos.json.ok === false) {
                this.log.error(`API position: ${pos.json.msg}`);
            } else {
                this.log.debug(`position: ${JSON.stringify(pos.json)}`);
                this.emit("position", { sn, pos: pos.json.data });
            }
        }
        if (request == "theft") {
            apiPath = `/gps/mobile/anti-theft/by-sn/${meta.antiTheftSn}`;
            const theft = await this.request("GET", apiPath, {
                ...this.authHeaders(),
                "Content-Type": "application/json; charset=UTF-8",
            });
            if (theft.json && theft.json.ok === false) {
                this.log.error(`API theft: ${theft.json.msg}`);
            } else {
                if (theft.json.data.fenceCenterLon != null) {
                    meta.mapLon = theft.json.data.fenceCenterLon;
                }
                if (theft.json.data.fenceCenterLat) {
                    meta.mapLat = theft.json.data.fenceCenterLat;
                }
                if (theft.json.data.fenceRadiusSettingId) {
                    meta.fenceRadiusSettingId = theft.json.data.fenceRadiusSettingId;
                }
                this.log.debug(`theft: ${JSON.stringify(theft.json)}`);
                this.emit("theft", { sn, theft: theft.json.data });
            }
        }
        //apiPath = `/gps/anti-theft/send-track?sn=${meta.antiTheftSn}&trackStatus=1`;
        //apiPath = `/gps/anti-theft/send-track?sn=${meta.antiTheftSn}&trackStatus=0`;
        //apiPath = `/gps/mobile/anti-theft/is-it-bound?deviceSn=${sn}`;
    },

    /**
     * @param {string} sn
     */
    async getInfo(sn) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        const apiPath = `/app_wireless_mower/device/info/${dev.deviceId}`;
        const res = await this.request("GET", `${apiPath}`, {
            "Content-Type": "application/json",
            ...this.authHeaders(),
        });
        if (res == "Timeout" || res == "Ratelimit") {
            return;
        }
        if (res.json && res.json.ok === false) {
            this.log.error(`API-getInfo: ${res.json.msg}`);
        } else {
            this.log.debug(`getInfo: ${JSON.stringify(res.json)}`);
            this.emit("zigzag", { sn: sn, data: res.json.data, path_multi: "settings" });
            if (res.json.data && res.json.data.custom) {
                meta.custom_multi = res.json.data.custom;
                this.emit("customZigzag", { sn: sn, data: res.json.data });
            }
            if (typeof res.json.data.antiTheftSn === "string" && res.json.data.antiTheftSn != "") {
                if (!meta.antiTheftSn) {
                    meta.antiTheftSn = res.json.data.antiTheftSn;
                    await this.getAntiTheftX(sn, "list");
                    await this.getAntiTheftX(sn, "pos");
                    await this.getAntiTheftX(sn, "theft");
                }
            }
            if (res.json.data.lat != null) {
                meta.lat = res.json.data.lat;
            }
            if (res.json.data.lng != null) {
                meta.lng = res.json.data.lng;
            }
            this.changeAttributeName(res.json.data);
            this.emit("deviceSettingsState", sn, res.json.data);
        }
    },

    /**
     * @param {string} sn
     * @param {string} command
     * @param {any} value
     */
    async sendCommand(sn, command, value) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return;
        }
        if (this.options.apptype === "Old") {
            return this.sendCommandOld(dev, command);
        }
        if (meta.modelClass === "V1") {
            return this.sendCommandV1(dev, meta, command, value);
        }
        return this.sendCommandNew(dev, meta, command, value);
    },

    /**
     * @param {any} dev
     * @param {any} meta
     * @param {string} command
     * @param {any} value
     */
    async sendCommandNew(dev, meta, command, value) {
        const action = NEW_ACTIONS[command];
        if (!action) {
            this.log.error(`Command unknown: ${command}`);
            return;
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
            data.work_order = 0;
        }
        if (
            command === "backup_delete" ||
            command === "useThisMap" ||
            command === "backup_delete_active" ||
            command === "backup_map"
        ) {
            data.map_id = value;
        }
        if (command === "reset_small_bladeplate") {
            data.consumable_items = ["small_cutter"];
        }
        if (command === "reset_small_blade") {
            data.consumable_items = ["small_blade"];
        }
        if (command === "reset_bladeplate") {
            data.consumable_items = ["cutter"];
        }
        if (command === "reset_blade") {
            data.consumable_items = ["blade"];
        }
        if (command === "merge_zones") {
            data.region_id = value;
        }
        if (command === "passages") {
            data.points = value;
        }
        if (command === "split_zones") {
            data.points = value.points;
            data.region_id = value.region;
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}action`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
        } else {
            this.log.debug(`sendCommandNew: ${JSON.stringify(res.json)}`);
        }
    },

    /**
     * @param {any} dev
     * @param {any} meta
     * @param {string} command
     * @param {any} value
     */
    async sendCommandV1(dev, meta, command, value) {
        const mode = V1_MODES[command];
        const action = V1_ACTION[command];
        if (mode === undefined && action === undefined) {
            this.log.error(`V1: Command ${command} is not supported.`);
            return;
        }
        let data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            method: action.method,
        };
        if (mode !== undefined) {
            data[action.val] = mode[command];
        } else if (action !== undefined) {
            data[action.val] = value;
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}setProperty`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
        } else {
            this.log.debug(`sendCommandV1: ${JSON.stringify(res.json)}`);
        }
    },

    /**
     * @param {any} dev
     * @param {string} command
     */
    async sendCommandOld(dev, command) {
        const mode = OLD_MODES[command];
        if (mode === undefined) {
            this.log.error(`Old: Command ${command} is not supported.`);
            return;
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
            this.log.error(`API: ${res.json.msg}`);
        } else {
            this.log.debug(`sendCommandOld: ${JSON.stringify(res.json)}`);
        }
    },

    /**
     * @param {string} sn
     * @param {string} oldpin
     * @param {string} newpin
     * @returns {Promise<boolean>}
     */
    async changePin(sn, oldpin, newpin) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            cmd: "set_password",
            deviceSn: dev.deviceSn,
            id: "resetPassword",
            method: "action",
            new_pwd: newpin,
            old_pwd: oldpin,
        };
        const endpoint = "action";
        const res = await this.request(
            "POST",
            `${meta.cmdurl}${endpoint}`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`changePin: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} id
     * @param {string} sn
     * @param {any} data
     * @returns {Promise<boolean>}
     */
    async setRemark(id, sn, data) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const res = await this.request(
            "PUT",
            `/app_wireless_mower/device-user/remark`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API remark: ${res.json.msg}`);
            return false;
        }
        if (this.standalone) {
            await this.iob.setState(id, { val: "", ack: true });
        }
        this.log.debug(`setRemark: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} id
     * @param {string} sn
     * @param {any[]} snList
     * @param {number} type
     * @returns {Promise<boolean>}
     */
    async setTopUp(id, sn, snList, type) {
        const meta = this.deviceMeta[sn];
        if (!meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const data = {
            snList: snList,
        };
        const res = await this.request(
            "PUT",
            `/app_wireless_mower/device-user/topUp`,
            {
                ...this.authHeaders(),
                "Content-Type": "application/json",
            },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API topUp: ${res.json.msg}`);
            return false;
        }
        if (this.standalone) {
            if (type === 1) {
                await this.iob.setState(id, { val: true, ack: true });
            } else {
                await this.iob.setState(id, { val: JSON.stringify(snList), ack: true });
            }
        }
        this.log.debug(`setTopUp: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} id
     * @param {string} sn
     * @param {string} deviceId
     * @param {string} devSn
     * @param {string} obj
     * @param {string} noneId
     * @returns {Promise<boolean>}
     */
    async deleteDevice(id, sn, deviceId, devSn, obj, noneId) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const res = await this.request("DELETE", `/app_wireless_mower/device-user/${deviceId}`, {
            ...this.authHeaders(),
            "Content-Type": "application/json",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API delete: ${res.json.msg}`);
            return false;
        }
        if (this.standalone) {
            await this.iob.setState(id, { val: false, ack: true });
            await this.iob.setObject(noneId, obj);
            await this.iob.setState(noneId, { val: "none", ack: true });
            await this.iob.delObjectAsync(devSn, {
                recursive: true,
            });
        }
        this.log.debug(`deleteDevice: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string[]} ids
     */
    async deleteMessages(ids) {
        if (!ids || !Array.isArray(ids)) {
            this.log.error(`Wrong data type: ${JSON.stringify(ids)}`);
        }
        const res = await this.request(
            "DELETE",
            `/app_wireless_mower/message-send-logs`,
            {
                ...this.authHeaders(),
                "Content-Type": "application/json",
            },
            JSON.stringify(ids),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API delete messages: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`deleteMessages: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} id
     * @param {string} objId
     * @param {string} sn
     * @param {string} mail
     * @returns {Promise<boolean>}
     */
    async sendShareRequest(id, objId, sn, mail) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const data = {
            deviceId: dev.deviceId,
            shareUserName: mail,
            shareType: 1,
        };
        const res = await this.request(
            "POST",
            `/app_wireless_mower/device-user-share`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API share user: ${res.json.msg}`);
            return false;
        }
        if (this.standalone) {
            await this.iob.setState(id, { val: false, ack: true });
            await this.iob.setState(`${objId}.share_email`, { val: "", ack: true });
        }
        this.log.debug(`sendShareRequest: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} sn
     * @param {any} data
     * @param {string} objId
     * @returns {Promise<boolean>}
     */
    async setUnbind(sn, data, objId) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const res = await this.request(
            "POST",
            `/app_wireless_mower/device-user-share/unbind`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API unbind: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setUnbind: ${JSON.stringify(res.json)}`);
        if (this.standalone) {
            await this.iob.delObjectAsync(objId, {
                recursive: true,
            });
        }
        return true;
    },

    /**
     * @param {string} id
     * @param {string} val
     * @param {any} obj
     * @param {string} sn
     * @param {any} data
     * @returns {Promise<boolean>}
     */
    async acceptShareApplyInvite(id, val, obj, sn, data) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const res = await this.request(
            "POST",
            `/app_wireless_mower/device-user-share/invite/reply`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API accept: ${res.json.msg}`);
            return false;
        }
        if (this.standalone) {
            await this.iob.setState(id, { val: val, ack: true });
            await this.iob.setObject(obj._id, obj);
        }
        this.log.debug(`acceptShareApplyInvite: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} sn
     * @param {number} mode
     * @param {any} [angle]
     * @returns {Promise<boolean>}
     */
    async setPlanMode(sn, mode, angle) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            id: "setPlanAngle",
            key: "plan_angle",
            method: "set_property",
            plan_mode: mode,
            multi_zigzag_angles: angle,
        };
        const endpoint = meta.modelClass === "V1" ? "setProperty" : "set_property";
        const res = await this.request(
            "POST",
            `${meta.cmdurl}${endpoint}`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setSettings: ${JSON.stringify(res.json)}`);
        return false;
    },

    /**
     * @param {string} sn
     * @param {ioBroker.State | null | undefined} val
     * @returns {Promise<boolean>}
     */
    async setAutoUpgrade(sn, val) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        if (!val || val.val == null) {
            this.log.error(`Value is empty`);
            return false;
        }
        const data = {
            appId: String(dev.appUserId || this.session.user_id),
            deviceSn: dev.deviceSn,
            id: "setAutoUpgrade",
            key: "auto_upgrade",
            method: "set_property",
            value: val.val,
            time_zone: meta.time_zone,
            time: [{ start: 7200, end: 21600 }],
        };
        const endpoint = meta.modelClass === "V1" ? "setProperty" : "set_property";
        this.log.debug(`path ${meta.cmdurl}${endpoint} - ${JSON.stringify(data)}`);
        const res = await this.request(
            "POST",
            `${meta.cmdurl}${endpoint}`,
            { ...this.authHeaders() },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setAutoUpgrade: ${JSON.stringify(res.json)}`);
        return true;
    },
    /**
     * @param {string} sn
     * @param {ioBroker.State | null | undefined} val
     * @returns {Promise<boolean>}
     */
    async setDeviceName(sn, val) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        if (!val || !val.val || val.val == "") {
            this.log.error(`Device name is empty`);
            return false;
        }
        let data = {};
        let method = "PUT";
        let path = "/app_wireless_mower/device/appEditDevice";
        if (this.options.apptype === "Old") {
            data = {
                deviceSn: dev.deviceSn,
                appId: String(dev.appUserId || this.session.user_id),
                rename: val.val,
            };
            method = "POST";
            path = "/app_mower/device/setNickName";
        } else {
            data = {
                sn: dev.deviceSn,
                deviceName: val.val,
            };
        }
        this.log.debug(`setChangeName: ${method} - ${path} ${JSON.stringify(data)}`);
        const res = await this.request(
            method,
            path,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setDeviceSettings: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} sn
     * @param {any} value
     * @param {string} id
     * @param {string} key
     * @param {any} addValue
     * @returns {Promise<boolean>}
     */
    async setSettings(sn, value, id, key, addValue) {
        this.log.debug(`sn: ${sn} - value: ${value} - id: ${id} - key: ${key}`);
        if (value != null) {
            const dev = this.devicesRaw[sn];
            const meta = this.deviceMeta[sn];
            if (!dev || !meta) {
                this.log.error(`Device ${sn} unknown!`);
                return false;
            }
            const data = {
                appId: String(dev.appUserId || this.session.user_id),
                deviceSn: dev.deviceSn,
                id: id,
                key: key,
                method: "set_property",
                value: value,
                ...addValue,
            };
            const endpoint = meta.modelClass === "V1" ? "setProperty" : "set_property";
            this.log.debug(`path ${meta.cmdurl}${endpoint} - ${JSON.stringify(data)}`);
            const res = await this.request(
                "POST",
                `${meta.cmdurl}${endpoint}`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
            if (res.json && res.json.ok === false) {
                this.log.error(`API: ${res.json.msg}`);
                return false;
            }
            this.log.debug(`setSettings: ${JSON.stringify(res.json)}`);
            return true;
        }
        return false;
    },

    /**
     * @param {string} sn
     * @param {number} gap
     * @param {number} speed
     * @returns {Promise<boolean>}
     */
    async setMowEfficiency(sn, gap, speed) {
        this.log.debug(`sn: ${sn} - gap: ${gap} - speed: ${speed}`);
        if (gap != null || speed != null) {
            const dev = this.devicesRaw[sn];
            const meta = this.deviceMeta[sn];
            if (!dev || !meta) {
                this.log.error(`Device ${sn} unknown!`);
                return false;
            }
            const data = {
                appId: String(dev.appUserId || this.session.user_id),
                deviceSn: dev.deviceSn,
                id: "setMowEfficiency",
                key: "mow_efficiency",
                method: "set_property",
                speed: speed,
                gap: gap,
            };
            const endpoint = meta.modelClass === "V1" ? "setProperty" : "set_property";
            const res = await this.request(
                "POST",
                `${meta.cmdurl}${endpoint}`,
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify(data),
            );
            if (res.json && res.json.ok === false) {
                this.log.error(`API: ${res.json.msg}`);
                return false;
            }
            this.log.debug(`setMowEfficiency: ${JSON.stringify(res.json)}`);
            return true;
        }
        return false;
    },

    /**
     * @param {string} sn
     * @param {"speed"|"height"} key
     * @param {number} value
     * @returns {Promise<boolean>}
     */
    async setBlade(sn, key, value) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        if (this.options.apptype === "Old") {
            this.log.error("Blade control is not supported for the legacy API.");
            return false;
        }
        const intVal = Math.round(Number(value));
        if (!Number.isFinite(intVal)) {
            this.log.error(`Invalid value: ${value}`);
            return false;
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
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setBlade: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} sn
     * @param {boolean} flag
     * @param {number} durationMin
     * @returns {Promise<boolean>}
     */
    async setRain(sn, flag, durationMin) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const duration = Math.max(0, Math.min(720, Math.round(Number(durationMin))));
        const appId = String(dev.appUserId || this.session.user_id);

        if (this.options.apptype === "Old") {
            const res = await this.request(
                "POST",
                "/app_mower/device/setRain",
                { ...this.authHeaders(), "Content-Type": "application/json" },
                JSON.stringify({
                    appId,
                    deviceSn: sn,
                    rainDelayDuration: duration,
                    rainFlag: flag,
                }),
            );
            if (res.json && res.json.ok === false) {
                this.log.error(`API: ${res.json.msg}`);
                return false;
            }
            this.log.debug(`setRain old: ${JSON.stringify(res.json)}`);
            return true;
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
                this.log.error(`API: ${res.json.msg}`);
                return false;
            }
            this.log.debug(`setRain V1: ${JSON.stringify(res.json)}`);
            return true;
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
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setRain: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * @param {string} sn
     * @param {number} value
     * @returns {Promise<boolean>}
     */
    async setPatternExpirationTime(sn, value) {
        if (value % 5 != 0) {
            this.log.warn(`Time only in 5 days increments!`);
            return false;
        }
        if (value < 5 || value > 30) {
            this.log.warn(`Duration of 5 to 30 days possible!`);
            return false;
        }
        const res = await this.setDeviceProperty(sn, {
            id: "SetCustomAreaKeepConfig",
            key: "custom_area_keep_config",
            custom_area_auto_clear: true,
            custom_area_keep_day: value,
            edit_time: new Date().getTime(),
        });
        return res ? true : false;
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
            this.log.error(`Format "HH:MM-HH:MM" expected, data: "${trimmed}"`);
            return null;
        }
        const sh = Number(m[1]);
        const sm = Number(m[2]);
        const eh = Number(m[3]);
        const em = Number(m[4]);
        if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
            this.log.error(`Invalid time: "${trimmed}"`);
            return null;
        }
        return { startSec: sh * 3600 + sm * 60, endSec: eh * 3600 + em * 60 };
    },

    /**
     * @param {number} sec
     * @returns {string}
     */
    secToHms(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    },

    /**
     * plan.monday..plan.sunday: "HH:MM-HH:MM" string (empty = day off)
     * plan.pause: boolean (default false) — pause whole schedule
     *
     * @param {string} sn
     * @param {Record<string, any>} plan
     * @param {Record<string, any>} plan2
     * @returns {Promise<boolean>}
     */
    async setSchedule(sn, plan, plan2) {
        const dev = this.devicesRaw[sn];
        const meta = this.deviceMeta[sn];
        if (!dev || !meta) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const safePlan = plan && typeof plan === "object" ? plan : {};
        const parsed = DAYS.map((key, i) => ({
            dayIndex: i + 1,
            key,
            window: this.parseScheduleDay(safePlan[key].time),
            unlock: safePlan[key].unlock,
            zone: safePlan[key].zone,
            active: safePlan[key].active,
            order: safePlan[key].order,
            border: safePlan[key].border,
        }));
        const safePlan2 = plan2 && typeof plan2 === "object" ? plan2 : {};
        const parsed2 = DAYS.map((key, i) => ({
            dayIndex: i + 1,
            key,
            window: this.parseScheduleDay(safePlan2[key].time),
            unlock: safePlan[key].unlock,
            zone: safePlan[key].zone,
            active: safePlan[key].active,
            order: safePlan[key].order,
            border: safePlan[key].border,
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
                this.log.error(`API: ${res.json.msg}`);
                return false;
            }
            this.log.debug(`setSchedule old: ${JSON.stringify(res.json)}`);
            return true;
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
                this.log.error(`API: ${res.json.msg}`);
                return false;
            }
            this.log.debug(`setSchedule v1: ${JSON.stringify(res.json)}`);
            return true;
        }

        // S/X/V — set_property time_tactics. Mon=1..Sat=6, Sun=0
        const dayPeriod = {
            "1_monday": 1,
            "2_tuesday": 2,
            "3_wednesday": 3,
            "4_thursday": 4,
            "5_friday": 5,
            "6_saturday": 6,
            "0_sunday": 0,
        };
        const time = [];
        for (const p of parsed) {
            if (!p.window) {
                continue;
            }
            time.push({
                unlock: p.unlock,
                period: [dayPeriod[p.key]],
                start: p.window.startSec,
                active: p.active,
                end: p.window.endSec,
                need_fllow_boader: p.border,
                order: p.order,
                region_id: p.zone,
            });
        }
        for (const p of parsed2) {
            if (!p.window) {
                continue;
            }
            time.push({
                unlock: p.unlock,
                period: [dayPeriod[p.key]],
                start: p.window.startSec,
                active: p.active,
                end: p.window.endSec,
                need_fllow_boader: p.border,
                order: p.order,
                region_id: p.zone,
            });
        }
        const allData = {
            appId,
            deviceSn: sn,
            id: "setTimeTactics",
            key: "time_tactics",
            method: "set_property",
            time,
            time_custom_flag: meta.time_custom_flag,
            recommended_time_flag: meta.recommended_time_flag,
            time_zone: meta.time_zone,
            pause,
        };
        const check = this.doubleCheck(allData);
        this.log.debug(`setSchedule: ${JSON.stringify(allData)}`);
        if (!check) {
            this.log.warn(`Wrong Schedule!!!`);
            return false;
        }
        const res = await this.request(
            "POST",
            `${meta.cmdurl}set_property`,
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify(allData),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`setSchedule: ${JSON.stringify(res.json)}`);
        return true;
    },

    /**
     * Invalid JSON causes the app to crash and renders the mower unusable.
     * Performing a factory reset or unpairing and re-pairing does not resolve this issue
     *
     * @param {any} allData
     * @returns {boolean}
     */
    doubleCheck(allData) {
        if (allData && typeof allData.time === "object" && Object.keys(allData.time).length > 0) {
            const double_slot = {};
            const inRange = (/** @type {number} */ num, /** @type {number} */ min, /** @type {number} */ max) =>
                num >= min && num <= max;
            for (const slot of allData.time) {
                if (!slot) {
                    this.log.warn(`Slot is empty - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (typeof slot.start !== "number" || typeof slot.end !== "number") {
                    this.log.warn(`Start or end time must be a number - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.start > slot.end) {
                    this.log.warn(`The start time must not be later than the end time - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.start > 86400) {
                    this.log.warn(`Start time must not exceed 86,400 seconds - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.end > 86400) {
                    this.log.warn(`End time must not exceed 86,400 seconds - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (typeof slot.period !== "object") {
                    this.log.warn(`Period is not an object - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (typeof slot.period[0] !== "number") {
                    this.log.warn(`Period value is not a number - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.period.length > 1) {
                    this.log.warn(`Period has too many values - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.period[0] < 0 || slot.period[0] > 6) {
                    this.log.warn(`The period value must be between 0 and 6 - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.unlock != null && typeof slot.unlock !== "boolean") {
                    this.log.warn(`Wrong unlock type - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.active != null && typeof slot.active !== "boolean") {
                    this.log.warn(`Wrong active type - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.need_fllow_boader != null && typeof slot.need_fllow_boader !== "boolean") {
                    this.log.warn(`Wrong need_fllow_boader type - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.order != null && typeof slot.order !== "number") {
                    //ToDo: What is the maximum allowed value
                    this.log.warn(`Wrong order type - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (slot.region_id != null && (typeof slot.region_id !== "object" || !Array.isArray(slot.region_id))) {
                    //ToDo: Check is region id valid
                    this.log.warn(`Wrong region_id type - ${JSON.stringify(slot)}`);
                    return false;
                }
                if (double_slot[slot.period[0]]) {
                    if (
                        inRange(slot.start, double_slot[slot.period[0]].start + 1, double_slot[slot.period[0]].end - 1)
                    ) {
                        this.log.warn(`Start time must not overlap - ${JSON.stringify(slot)}`);
                        return false;
                    }
                    if (inRange(slot.end, double_slot[slot.period[0]].start + 1, double_slot[slot.period[0]].end - 1)) {
                        this.log.warn(`End time must not overlap - ${JSON.stringify(slot)}`);
                        return false;
                    }
                } else {
                    double_slot[slot.period[0]] = {
                        start: slot.start,
                        end: slot.end,
                    };
                }
            }
            if (typeof allData.time_custom_flag !== "boolean") {
                this.log.warn(`Wrong time_custom_flag type - ${JSON.stringify(allData)}`);
                return false;
            }
            if (typeof allData.recommended_time_flag !== "boolean") {
                this.log.warn(`Wrong recommended_time_flag type - ${JSON.stringify(allData)}`);
                return false;
            }
            if (typeof allData.pause !== "boolean") {
                this.log.warn(`Wrong pause type - ${JSON.stringify(allData)}`);
                return false;
            }
            if (typeof allData.time_zone !== "number") {
                this.log.warn(`Wrong time_zone type - ${JSON.stringify(allData)}`);
                return false;
            }
            return true;
        }
        return false;
    },

    /**
     * Use directly
     *
     * @param {string} sn
     * @param {string} messageId
     * @returns {Promise<boolean>}
     */
    async messageMakeRead(sn, messageId) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const apiPath = `/app_wireless_mower/message-send-logs/read/${String(dev.appUserId || this.session.user_id)}/${messageId}`;
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json; charset=UTF-8",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Skin: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getDeviceSkin: ${JSON.stringify(res.json)}`);
        return true;
    },
    /**
     * Use directly
     *
     * @param {string} sn
     * @returns {Promise<boolean>}
     */
    async getDeviceSkin(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        //const apiPath = `/app_wireless_mower/device-skin/list?type=2&userId=${String(dev.appUserId || this.session.user_id)}`;
        const apiPath = `/app_wireless_mower/device-skin?userId=${String(dev.appUserId || this.session.user_id)}`;
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json; charset=UTF-8",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Skin: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getDeviceSkin: ${JSON.stringify(res.json)}`);
        this.emit("skin", { sn, data: res.json });
        return true;
    },
    /**
     * Use directly
     *
     * @param {string} sn
     * @returns {Promise<boolean>}
     */
    async getCommunityActivities(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const apiPath = `/app_wireless_mower/community_activities/${String(dev.appUserId || this.session.user_id)}`;
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json; charset=UTF-8",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Comminity: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getCommunityActivities: ${JSON.stringify(res.json)}`);
        this.emit("communities", { sn, data: res.json });
        return true;
    },
    /**
     * Use directly
     *
     * @param {string} sn
     * @param {string} type
     * @param {number} detail
     * @param {string} model
     * @param {number} base
     * @returns {Promise<boolean>}
     */
    async getErrorMessage(sn, type, detail, model, base) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        // detailType -1 or -10
        // clientModel example S4
        // type example error
        // mower_raw.nrtk_base example 0
        const apiPath = encodeURIComponent(
            `/app_wireless_mower/device/notice/pic/info?type=${type}&detailType=${detail}&clientModel=${model}&nrtkBase=${base}`,
        );
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "accept-encoding": "gzip",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Comminity: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getCommunityActivities: ${JSON.stringify(res.json)}`);
        this.emit("errorMessage", { sn, data: res.json });
        return true;
    },

    /**
     * @param {string} sn
     * @returns {Promise<boolean>}
     */
    async getWifi(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const apiPath = `/app_wireless_mower/device-wifi/${sn}`;
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json; charset=UTF-8",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Wifi: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getWifi: ${JSON.stringify(res.json)}`);
        this.emit("wifi", { sn, data: res.json });
        return true;
    },

    /**
     * Use directly
     *
     * @param {string} sn
     * @returns {Promise<boolean>}
     */
    async getAgreements(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const apiPath = `/app_wireless_mower/app-agreements/business-types/1/items`;
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json; charset=UTF-8",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Agreements: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getAgreements: ${JSON.stringify(res.json)}`);
        this.emit("agreements", { sn, data: res.json });
        return true;
    },
    /**
     * Use directly
     *
     * @param {string} type
     * @param {string} version
     * @returns {Promise<boolean>}
     */
    async checkAppUpdate(type, version) {
        const data = {
            appTypeCode: type,
            version: version,
        };
        const apiPath = `/app_wireless_mower/app-version/check`;
        const res = await this.request(
            "POST",
            apiPath,
            {
                ...this.authHeaders(),
                "Content-Type": "application/json; charset=UTF-8",
            },
            JSON.stringify(data),
        );
        if (res.json && res.json.ok === false) {
            this.log.error(`API Agreements: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getAgreements: ${JSON.stringify(res.json)}`);
        this.emit("appRelease", { data: res.json });
        return true;
    },
    /**
     * Use directly
     *
     * @param {string} sn
     * @returns {Promise<boolean>}
     */
    async getSettingsX(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const apiPath = `/app_wireless_mower/device/getDeviceSettingBySn?deviceSn=${sn}`;
        const res = await this.request("GET", apiPath, {
            ...this.authHeaders(),
            "Content-Type": "application/json; charset=UTF-8",
        });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Settings: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getSettingsX: ${JSON.stringify(res.json)}`);
        this.emit("settingsX", { sn, data: res.json });
        return true;
    },
    /**
     * Use directly
     * Response time and custom time. Slots 1 and 2 separate
     * For S and X devices
     *
     * @param {string} sn
     * @returns {Promise<boolean>}
     */
    async getScheduleX(sn) {
        const dev = this.devicesRaw[sn];
        if (!dev) {
            this.log.error(`Device ${sn} unknown!`);
            return false;
        }
        const apiPath = `/app_wireless_mower/device-setting/getTime/${sn}`;
        const res = await this.request("GET", apiPath, { ...this.authHeaders(), "Content-Type": "application/json" });
        if (res.json && res.json.ok === false) {
            this.log.error(`API Schedule: ${res.json.msg}`);
            return false;
        }
        this.log.debug(`getScheduleX: ${JSON.stringify(res.json)}`);
        this.emit("getTime", { sn, data: res.json });
        return true;
    },
    /**
     * @param {number} ms milliseconds
     */
    delay(ms) {
        return new Promise(resolve => {
            this._sleepTimer = this.iob.setTimeout(() => {
                this._sleepTimer = null;
                resolve(true);
            }, ms);
        });
    },
};

module.exports.NEW_ACTIONS = NEW_ACTIONS;
module.exports.OLD_MODES = OLD_MODES;
module.exports.V1_MODES = V1_MODES;
module.exports.V1_ACTION = V1_ACTION;
module.exports.DAYS = DAYS;
