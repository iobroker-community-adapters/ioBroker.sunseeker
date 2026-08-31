"use strict";

const crypto = require("node:crypto");
const axios = require("axios");

const URL_OLD = "https://server.sk-robot.com/api";
const HOST_OLD = "server.sk-robot.com";
const URL_XV_EU = "https://wirefree-specific.sk-robot.com/api";
const HOST_XV_EU = "wirefree-specific.sk-robot.com";
const URL_XV_US = "https://wirefree-specific-us.sk-robot.com/api";
const HOST_XV_US = "wirefree-specific-us.sk-robot.com";

// Sunseeker app 1.7.0: the "appId" is the Android device id (Settings.Secure
// ANDROID_ID) - a stable 64-bit hex value. We can't read a real android_id, so
// we generate our own 16-char hex once and persist it in the state auth.app_id.
// The same value is used as appIdCode in /admin/user/edit AND as the suffix of
// the MQTT username; both must match. Delete the state to force a new one.
const APP_VERSION = "1.7.0";

// Login password encryption (app 1.7.0): AES-128-CBC, key = iv = this value.
const LOGIN_AES_KEY = "pigxpigxpigxpigx";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0f7mbMVc/YIYQbR8Ty3u
7yx0cKX6Gt7JkVQrWynI7xM6/yVPMC1I7nXdjMlVPpc06UXoc5ClQNsTbQ4vumFg
2RZPQwAOc7yL1Y8t1W0b9jMTztu32ZzlobfzIVkIO1R7x1I+pkyp6QDm/MnvWyeu
CM77gS2bDv47H9COQn/gy/fy9uecyWCY3u+dXQhujLPrSJ2FFs6SwD0t5QEJjdrC
ftkKQFsflm+i5RQZBMNGT3LdAMnPK4avG642Afum0SzmNrEZrIo7pr2w0fvokbWB
SOOeEdGAx7UVI1kHssOohqW37yJzzFMIlahZSEJ0A3Dm6yrtgobp2mQlCisqsVW4
XwIDAQAB
-----END PUBLIC KEY-----`;

module.exports = {
    /**
     *  @returns {{url:string, host:string}}
     */
    getBase() {
        if (this.options.apptype === "Old") {
            return { url: URL_OLD, host: HOST_OLD };
        }
        if (this.options.region === "US") {
            return { url: URL_XV_US, host: HOST_XV_US };
        }
        return { url: URL_XV_EU, host: HOST_XV_EU };
    },

    /**
     *  @returns {Record<string,string>}
     */
    authHeaders() {
        const base = this.getBase();
        if (!this.session?.access_token) {
            throw new Error("authHeaders: no active Session");
        }
        // Match the app 1.7.0 exactly: it sends version + app on every request.
        return {
            "Accept-Language": this.options.language,
            version: APP_VERSION,
            app: "brand",
            Authorization: `bearer ${this.session.access_token}`,
            Host: base.host,
            Connection: "Keep-Alive",
            "User-Agent": "okhttp/4.8.1",
        };
    },

    /**
     * Authenticated HTTP request. On 401 the session is refreshed and the
     * request is retried once with the new bearer token; if it still 401s the
     * call throws.
     *
     * @param {string} method
     * @param {string} urlPath
     * @param {Record<string,string>} headers
     * @param {any} [data]
     */
    async request(method, urlPath, headers, data) {
        let res = await this._sendHttp(method, urlPath, headers, data);
        if (res.status === 401) {
            this.iob.log.warn("HTTP 401 - Token is being renewed");
            await this.refreshToken();
            const refreshed = {
                ...headers,
                Authorization: `bearer ${this.session.access_token}`,
            };
            res = await this._sendHttp(method, urlPath, refreshed, data);
            if (res.status === 401) {
                throw new Error(`${method} ${urlPath}: 401 after Token-Refresh`);
            }
        }
        if (res.data && typeof res.data === "object") {
            return { status: res.status, json: res.data };
        }
        const preview = typeof res.data === "string" ? res.data.slice(0, 200) : String(res.data);
        throw new Error(`${method} ${urlPath} non-JSON (HTTP ${res.status}): ${preview}`);
    },

    /**
     * @param {string} method
     * @param {string} urlPath
     * @param {Record<string, string>} headers
     * @param {any} data
     */
    async _sendHttp(method, urlPath, headers, data) {
        if (this.requestLimit.requestCount > this.maxRequest) {
            if (!this.requestLimit.requestBlock) {
                this.requestLimit.requestBlock = true;
                this.iob.log.warn(`The limit of ${this.maxRequest} requests has been reached!!`);
                await this.iob.setState(`rateLimit.request`, { val: JSON.stringify(this.requestLimit), ack: true });
            }
            return {
                status: 500,
                data: {
                    code: -1,
                    msg: `The limit of ${this.maxRequest} requests has been reached!!`,
                    data: "Ratelimit",
                    ok: false,
                },
            };
        }
        this.requestLimitCheck(method, urlPath, data);
        ++this.requestLimit.requestCount;
        const base = this.getBase();
        const url = `${base.url}${urlPath}`;
        this.iob.log.debug(`HTTP ${method} ${urlPath} ${typeof data === "object" ? JSON.stringify(data) : data}`);
        try {
            const res = await axios({
                method,
                url,
                headers,
                data,
                timeout: 15000,
                validateStatus: () => true,
            });
            this.iob.log.debug(`HTTP ${method} ${urlPath} -> ${res.status}`);
            return res;
        } catch (err) {
            let e;
            if (err.response) {
                e = err.response;
            } else if (err.request) {
                e = err.request;
            } else {
                e = err.message;
            }
            if (this.errorCounter > 10) {
                throw new Error(`Timeout ${JSON.stringify(e)}`);
            }
            this.errorMessage(err);
            ++this.errorCounter;
            this.iob.log.error(`_sendHttp: ${e}`);
            return { status: 500, data: { code: -1, msg: e, data: "Timeout", ok: false } };
        }
    },

    /**
     * @param {string} url
     */
    async getImages(url) {
        try {
            const res = await axios.get(url, {
                headers: {
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Encoding": "gzip, deflate, br, zstd",
                    "Content-Type": "image/png",
                    "Accept-Language": "de,en-US;q=0.7,en;q=0.3",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0",
                },
                timeout: 15000,
                responseType: "arraybuffer",
                validateStatus: () => true,
            });
            if (res.status !== 200 || !res.data) {
                this.iob.log.debug(`-getImages: HTTP ${res.status} empty!`);
                return null;
            }
            return res.data;
        } catch (err) {
            let e;
            if (err.response) {
                e = err.response;
            } else if (err.request) {
                e = err.request;
            } else {
                e = err.message;
            }
            this.iob.log.error(`_getImages: ${e}`);
            return null;
        }
    },

    /**
     * Account login. The New API (app 1.7.0) sends the password AES-128-CBC
     * encrypted (key = iv = "pigxpigxpigxpigx", PKCS5, base64) as JSON body
     * plus query params. The Old API keeps the plaintext form-urlencoded body.
     */
    async login() {
        const base = this.getBase();
        let res;
        if (this.options.apptype === "New") {
            const enc = this.encryptLoginPassword(this.password);
            const qs =
                `grant_type=password&password=${encodeURIComponent(enc)}` +
                `&scope=server&username=${encodeURIComponent(this.username)}`;
            res = await axios({
                method: "POST",
                url: `${base.url}/auth/oauth/token?${qs}`,
                headers: {
                    "Accept-Language": this.options.language,
                    version: APP_VERSION,
                    app: "brand",
                    Authorization: "Basic YXBwOmFwcA==",
                    "Content-Type": "application/json; charset=UTF-8",
                    Connection: "Keep-Alive",
                    "User-Agent": "okhttp/4.8.1",
                },
                data: JSON.stringify({
                    grant_type: "password",
                    password: enc,
                    scope: "server",
                    username: this.username,
                }),
                timeout: 15000,
                validateStatus: () => true,
            });
        } else {
            const body = new URLSearchParams({
                username: this.username,
                password: this.password,
                grant_type: "password",
                scope: "server",
            }).toString();
            res = await axios({
                method: "POST",
                url: `${base.url}/auth/oauth/token`,
                headers: {
                    "Accept-Language": this.options.language,
                    Authorization: "Basic YXBwOmFwcA==",
                    "Content-Type": "application/x-www-form-urlencoded",
                    Connection: "Keep-Alive",
                    "User-Agent": "okhttp/4.8.1",
                },
                data: body,
                timeout: 15000,
                validateStatus: () => true,
            });
        }
        const json = res.data;
        if (!json || typeof json !== "object" || !json.access_token) {
            throw new Error(`Login: No access_token (HTTP ${res.status}): ${JSON.stringify(json)}`);
        }
        this.session = json;
        this.session.next = new Date().getTime() + parseInt(this.session.expires_in) * 1000;
        this.session.next_refresh = new Date().getTime() + parseInt(this.session.refresh_expires_in) * 1000;
        this.session.action = 0;
        this.emit("session", this.session);
        this.iob.log.info(`Login OK user_id=${json.user_id}`);
    },

    /**
     * Update token
     */
    async refreshToken() {
        if (!this.session || !this.session.refresh_token) {
            await this.login();
            return;
        }
        const base = this.getBase();
        if (this.options.apptype === "New") {
            const url = `${base.url}/admin/new-oauth/oauth2-new/token?refresh_token=${encodeURIComponent(this.session.refresh_token)}`;
            try {
                const res = await axios({
                    method: "GET",
                    url,
                    headers: {
                        Authorization: "Basic YXBwOmFwcA==",
                        "accept-encoding": "gzip",
                        Connection: "Keep-Alive",
                        "User-Agent": "okhttp/4.8.1",
                    },
                    timeout: 15000,
                    validateStatus: () => true,
                });
                const json = res.data;
                if (json && json.access_token) {
                    this.session = json;
                    this.session.next = new Date().getTime() + parseInt(this.session.expires_in) * 1000;
                    this.session.next_refresh = new Date().getTime() + parseInt(this.session.refresh_expires_in) * 1000;
                    this.session.action = 0;
                    this.emit("session", this.session);
                    this.iob.log.info("Refresh Token (new-oauth)");
                    return;
                }
                this.iob.log.warn("Refresh failed. Initiating re-login");
                await this.login();
                return;
            } catch {
                throw new Error(`refreshToken: No access_token`);
            }
        }
        const body = new URLSearchParams({
            refresh_token: this.session.refresh_token,
            grant_type: "refresh_token",
            scope: "server",
        }).toString();
        try {
            const res = await axios({
                method: "POST",
                url: `${base.url}/auth/oauth/token`,
                headers: {
                    "Accept-Language": this.options.language,
                    Authorization: "Basic YXBwOmFwcA==",
                    "Content-Type": "application/x-www-form-urlencoded",
                    Connection: "Keep-Alive",
                    "User-Agent": "okhttp/4.8.1",
                },
                data: body,
                timeout: 15000,
                validateStatus: () => true,
            });
            const json = res.data;
            if (json && json.access_token) {
                this.session = json;
                this.session.next = new Date().getTime() + parseInt(this.session.expires_in) * 1000;
                this.session.next_refresh = new Date().getTime() + parseInt(this.session.refresh_expires_in) * 1000;
                this.session.action = 0;
                this.emit("session", this.session);
                this.iob.log.info("Refresh Token done");
            } else {
                this.iob.log.warn("Refresh failed. Initiating re-login!");
                await this.login();
            }
        } catch {
            throw new Error(`refreshToken: No access_token`);
        }
    },

    /**
     * Update token interval
     */
    _scheduleTokenRefreshOneTime() {
        if (this._refreshTimerOneTime) {
            this.iob.clearIntervalTimeOut(this._refreshTimerOneTime);
        }
        this._refreshTimerOneTime = this.iob.setTimeout(async () => {
            await this.requestLimitCheck();
            await this.refreshToken().catch(err => this.iob.log.error(`Token-Refresh: ${err.message}`));
            this._refreshTimerOneTime = null;
            this.iob.log.debug(`Start refresh interval`);
            this._scheduleTokenRefresh();
        }, this.session.action);
    },

    /**
     * Update token interval
     */
    _scheduleTokenRefresh() {
        if (this._refreshTimer) {
            this.iob.clearInterval(this._refreshTimer);
        }
        const ttlSec = (this.session && this.session.expires_in ? Number(this.session.expires_in) : 3600) - 60;
        this._refreshTimer = this.iob.setInterval(
            async () => {
                await this.requestLimitCheck();
                this.refreshToken().catch(err => this.iob.log.error(`Token-Refresh: ${err.message}`));
            },
            Math.max(60, ttlSec) * 1000,
        );
    },

    /**
     * @param {import("node:buffer").WithImplicitCoercion<string>} plaintext
     */
    encryptRsa(plaintext) {
        return crypto
            .publicEncrypt(
                { key: PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
                Buffer.from(plaintext, "utf8"),
            )
            .toString("base64");
    },

    /**
     * Encrypt the account password like the app 1.7.0 for /auth/oauth/token:
     * AES-128-CBC, key = iv = "pigxpigxpigxpigx", PKCS5, base64 (no wrap).
     *
     * @param {string} plaintext
     * @returns {string}
     */
    encryptLoginPassword(plaintext) {
        const key = Buffer.from(LOGIN_AES_KEY, "utf8");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, key);
        return Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]).toString("base64");
    },

    /**
     * Random 24-char string. Matches the app's generator charset
     * ([A-Za-z0-9]) rather than hex, so the value is byte-shaped like the app.
     *
     * @param {number} len
     * @returns {string}
     */
    randomString(len) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const bytes = crypto.randomBytes(len);
        let out = "";
        for (let i = 0; i < len; i++) {
            out += chars[bytes[i] % chars.length];
        }
        return out;
    },

    /**
     * GET /admin/user/app/info?appIdCode=<appId>. Mirrors the app: returns the
     * per-appId user info incl. mqttsPasswordFlag and the MQTT broker domains.
     * Caches the wirefree broker host and the flag on the instance.
     *
     * @returns {Promise<any>}
     */
    async getAppUserInfo() {
        await this.ensureAppId();
        const res = await this.request("GET", `/admin/user/app/info?appIdCode=${encodeURIComponent(this.appId)}`, {
            ...this.authHeaders(),
            "Content-Type": "application/json",
        });
        const data = res.json && res.json.data ? res.json.data : {};
        this.mqttsPasswordFlag = data.mqttsPasswordFlag === true;
        if (typeof data.mqttWirefreeDomainName === "string" && data.mqttWirefreeDomainName) {
            this.mqttWirefreeDomain = data.mqttWirefreeDomainName;
        }
        return data;
    },

    /**
     * Ensure a stable app id (imitates the Android ANDROID_ID: 16 hex chars).
     * Loaded from / persisted to the state auth.app_id so it survives restarts
     * and can be inspected or deleted by the user. A missing/invalid value is
     * regenerated. The value is cached in this.appId for the running session.
     *
     * @returns {Promise<string>}
     */
    async ensureAppId() {
        if (this.appId) {
            return this.appId;
        }
        // A read error must NOT be treated as "missing": overwriting on a
        // transient failure would replace a valid stored id and break the
        // MQTT username mapping. Only a successful read yielding a
        // missing/invalid value triggers generation.
        let st;
        try {
            st = await this.iob.getStateAsync("auth.app_id");
        } catch (err) {
            throw new Error(`ensureAppId: reading auth.app_id failed: ${err.message}`);
        }
        if (st && typeof st.val === "string" && /^[0-9a-f]{16}$/.test(st.val)) {
            this.appId = st.val;
            return this.appId;
        }
        const appId = crypto.randomBytes(8).toString("hex");
        // Persist before caching, so a failed write is retried on the next
        // call instead of leaving an unpersisted id in memory.
        await this.iob.setStateAsync("auth.app_id", { val: appId, ack: true });
        this.appId = appId;
        this.iob.log.info(`Generated new MQTT app id: ${appId}`);
        return this.appId;
    },

    /**
     * @param {string} sn
     * @param {any} data
     */
    async ownRequest(sn, data) {
        try {
            const json = JSON.parse(data);
            this.iob.log.debug(`ownRequest: ${JSON.stringify(json)}`);
            if (json.method && json.url) {
                if (json.auth) {
                    json.headers.Authorization = `bearer ${this.session.access_token}`;
                }
                const res = await this._sendHttp(json.method, json.url, json.headers, json.data);
                let dat = {};
                if (res.status !== 200) {
                    this.iob.log.warn("HTTP 401 - Token is being renewed");
                    dat = { error: JSON.stringify(res.data) };
                }
                if (res.data && typeof res.data === "object") {
                    dat = res.data;
                }
                this.emit("own", { sn: sn, data: dat });
            } else {
                this.iob.log.warn(`Missing url or method`);
            }
        } catch (e) {
            this.iob.log.error(`ownRequest: ${e}`);
        }
    },

    /**
     * Set the MQTT password on the account (PUT /admin/user/edit), byte-shaped
     * exactly like the app 1.7.0: RSA(PKCS1)-encrypted 24-char password, base64
     * wrapped at 76 chars with trailing newline (Android Base64.DEFAULT).
     */
    async editMqttPassword() {
        if (!this.session?.access_token) {
            throw new Error("editMqttPassword: No active Session");
        }
        await this.ensureAppId();
        this.mqttPassword = this.randomString(24);
        // Android Base64.DEFAULT: line-wrap every 76 chars + trailing "\n".
        const encrypted = `${this.encryptRsa(this.mqttPassword).replace(/(.{76})/g, "$1\n")}\n`;
        this.emit("mqtt_auth", { pw: this.mqttPassword, key: encrypted });
        const res = await this.request(
            "PUT",
            "/admin/user/edit",
            { ...this.authHeaders(), "Content-Type": "application/json; charset=UTF-8" },
            JSON.stringify({
                appIdCode: this.appId,
                appType: 3,
                appVersion: APP_VERSION,
                mqttsPassword: encrypted,
                operatingSystemCode: "android",
            }),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`MQTT-Password: ${res.json.msg}`);
        } else {
            this.iob.log.debug(`editMqttPassword: ${JSON.stringify(res)}`);
        }
    },
    /**
     * @param {{ response: any; request: any; message: any; }} err
     */
    errorMessage(err) {
        let e;
        if (err.response) {
            e = err.response;
        } else if (err.request) {
            e = err.request;
        } else {
            e = err.message;
        }
        this.iob.log.error(`errorMessage: ${e}`);
    },
    /**
     * @param {string|undefined|null} [method]
     * @param {string|undefined|null} [urlPath]
     * @param {any} [data]
     */
    async requestLimitCheck(method, urlPath, data) {
        const week = this.getWeek();
        const diffTime = new Date().getTime() - this.requestLimit.requestLast;
        if (diffTime > 24 * 60 * 1000 * 60 || this.requestLimit.day != week) {
            this.requestLimit.requestCount = 1;
            this.requestLimit.requestLast = new Date().getTime();
            this.requestLimit.requestTime = new Date().toISOString();
            this.requestLimit.requestBlock = false;
            this.requestLimit.day = week;
            this.requestLimit.request = [];
        }
        if (method) {
            const req = {
                count: this.requestLimit.requestCount,
                method: method,
                urlPath: urlPath,
                data: data,
                timestamp: new Date().getTime(),
                time: new Date().toISOString(),
            };
            this.requestLimit.request.push(req);
            if (this.requestLimit.request.length > 100) {
                this.requestLimit.request.pop();
            }
            this.requestLimit.request.sort(
                (/** @type {{ count: number; }} */ a, /** @type {{ count: number; }} */ b) => b.count - a.count,
            );
            await this.iob.setState(`rateLimit.request`, { val: JSON.stringify(this.requestLimit), ack: true });
        }
    },
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
    },
};

module.exports.APP_VERSION = APP_VERSION;
