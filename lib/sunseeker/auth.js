"use strict";

const crypto = require("node:crypto");
const axios = require("axios");

const URL_OLD = "https://server.sk-robot.com/api";
const HOST_OLD = "server.sk-robot.com";
const URL_XV_EU = "https://wirefree-specific.sk-robot.com/api";
const HOST_XV_EU = "wirefree-specific.sk-robot.com";
const URL_XV_US = "https://wirefree-specific-us.sk-robot.com/api";
const HOST_XV_US = "wirefree-specific-us.sk-robot.com";

const APP_ID = "0123456789abcdef";

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
    /** @returns {{url:string, host:string}} */
    getBase() {
        if (this.options.apptype === "Old") {
            return { url: URL_OLD, host: HOST_OLD };
        }
        if (this.options.region === "US") {
            return { url: URL_XV_US, host: HOST_XV_US };
        }
        return { url: URL_XV_EU, host: HOST_XV_EU };
    },

    authHeaders() {
        const base = this.getBase();
        if (!this.session?.access_token) {
            throw new Error("authHeaders: keine aktive Session");
        }
        return {
            "Accept-Language": this.options.language,
            Authorization: `bearer ${this.session.access_token}`,
            Host: base.host,
            Connection: "Keep-Alive",
            "User-Agent": "okhttp/4.4.1",
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
            this.log.warn("HTTP 401 - Token is being renewed");
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

    async _sendHttp(method, urlPath, headers, data) {
        const base = this.getBase();
        const url = `${base.url}${urlPath}`;
        this.log.debug(`HTTP ${method} ${urlPath}`);
        const res = await axios({
            method,
            url,
            headers,
            data,
            timeout: 15000,
            validateStatus: () => true,
        });
        this.log.debug(`HTTP ${method} ${urlPath} -> ${res.status}`);
        return res;
    },

    async login() {
        const base = this.getBase();
        const body = new URLSearchParams({
            username: this.username,
            password: this.password,
            grant_type: "password",
            scope: "server",
        }).toString();
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
        if (!json || typeof json !== "object" || !json.access_token) {
            throw new Error(`Login: kein access_token (HTTP ${res.status}): ${JSON.stringify(json)}`);
        }
        this.session = json;
        this.log.info(`Login OK user_id=${json.user_id}`);
    },

    async refreshToken() {
        if (!this.session || !this.session.refresh_token) {
            await this.login();
            return;
        }
        const base = this.getBase();
        if (this.options.apptype === "New") {
            const url = `${base.url}/admin/new-oauth/oauth2-new/token?refresh_token=${encodeURIComponent(this.session.refresh_token)}`;
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
                this.log.info("Refresh Token (new-oauth)");
                return;
            }
            this.log.warn("Refresh failed. Initiating re-login");
            await this.login();
            return;
        }
        const body = new URLSearchParams({
            refresh_token: this.session.refresh_token,
            grant_type: "refresh_token",
            scope: "server",
        }).toString();
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
            this.log.info("Refresh Token done");
        } else {
            this.log.warn("Refresh failed. Initiating re-login!");
            await this.login();
        }
    },

    _scheduleTokenRefresh() {
        if (this._refreshTimer) {
            this.iobTimer.clearInterval(this._refreshTimer);
        }
        const ttlSec = (this.session && this.session.expires_in ? Number(this.session.expires_in) : 3600) - 60;
        this._refreshTimer = this.iobTimer.setInterval(
            () => {
                this.refreshToken().catch(err => this.log.error(`Token-Refresh: ${err.message}`));
            },
            Math.max(60, ttlSec) * 1000,
        );
        this._refreshTimer.unref?.();
    },

    encryptRsa(plaintext) {
        return crypto
            .publicEncrypt(
                { key: PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
                Buffer.from(plaintext, "utf8"),
            )
            .toString("base64");
    },

    randomMqttPassword() {
        return crypto.randomBytes(16).toString("hex").slice(0, 24);
    },

    async editMqttPassword() {
        if (!this.session?.access_token) {
            throw new Error("editMqttPassword: keine aktive Session");
        }
        this.mqttPassword = this.randomMqttPassword();
        const encrypted = this.encryptRsa(this.mqttPassword);
        const res = await this.request(
            "PUT",
            "/admin/user/edit",
            { ...this.authHeaders(), "Content-Type": "application/json" },
            JSON.stringify({
                appIdCode: APP_ID,
                appType: 2,
                mqttsPassword: encrypted,
                operatingSystemCode: "android",
            }),
        );
        if (res.json && res.json.ok === false) {
            throw new Error(`MQTT-Passwort: ${res.json.msg}`);
        }
    },
};

module.exports.APP_ID = APP_ID;
