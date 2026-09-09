"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Writable, Readable } = require("node:stream");
const axios = require("axios");

let _PImage = null;
let _PImageTried = false;
function loadPImage() {
    if (_PImageTried) {
        return _PImage;
    }
    _PImageTried = true;
    try {
        _PImage = require("pureimage");
    } catch {
        _PImage = null;
    }
    return _PImage;
}

let _robotSprite = { value: null };
let _chargerSprite = { value: null };
/**
 * @param {{ decodePNGFromStream: (arg0: Readable) => any; }} PImage
 * @param {string} name
 * @param {{ value: any; }} cacheRef
 */
async function loadSprite(PImage, name, cacheRef) {
    if (cacheRef.value) {
        return cacheRef.value;
    }
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) {
        return null;
    }
    const buf = fs.readFileSync(file);
    const stream = Readable.from(buf);
    cacheRef.value = await PImage.decodePNGFromStream(stream);
    return cacheRef.value;
}

module.exports = {
    /**
     * Fetch and emit map data for a device. S/X only — others noop.
     * Emits 'map' { sn, kind, payload } per endpoint and finally 'livemap'
     * with a rendered PNG data URL when geometry is available.
     *
     * @param {string} sn
     */
    async fetchMap(sn) {
        if (this.options.apptype === "Old") {
            return;
        }
        const meta = this.deviceMeta[sn];
        if (!meta || (meta.modelClass !== "S" && meta.modelClass !== "X")) {
            this.iob.log.debug(`fetchMap ${sn}: Skip modelclass ${meta && meta.modelClass} without maps`);
            return;
        }
        if (meta._mapInFlight) {
            this.iob.log.debug(`fetchMap ${sn}: is running`);
            return;
        }
        meta._mapInFlight = true;
        this.iob.log.debug(`fetchMap ${sn}: Request map infos`);
        try {
            const info = await this.request(
                "GET",
                `/wireless_map/wireless_device/get?deviceSn=${encodeURIComponent(sn)}`,
                this.authHeaders(),
            );
            const data = info.json && info.json.data;
            if (!data || data == "Timeout" || data == "Ratelimit") {
                this.iob.log.debug(`fetchMap ${sn}: No map.info data`);
                return;
            }
            this.iob.log.debug(`fetchMap: ${JSON.stringify(data)}`);
            this.emit("map", { sn, kind: "info", payload: data });

            const newMapId = data.mapModifyTime;
            const mapChanged = newMapId !== undefined && newMapId !== meta.mapid;
            if (newMapId !== undefined) {
                if (mapChanged) {
                    this.iob.log.debug(`fetchMap ${sn}: mapModifyTime ${meta.mapid || "?"} -> ${newMapId}`);
                    meta.mapid = newMapId;
                    meta.livePath = [];
                } else {
                    this.iob.log.debug(`fetchMap ${sn}: mapModifyTime ${newMapId} unchanged`);
                }
            }

            if (mapChanged || !meta.mapJson) {
                const heat = await this.request(
                    "GET",
                    `/wireless_map/wireless_device/getHeatMap?deviceSn=${encodeURIComponent(sn)}`,
                    this.authHeaders(),
                );
                const heatData = heat.json && heat.json.data;
                if (heatData && heatData != "Timeout" && heatData != "Ratelimit") {
                    this.iob.log.debug(
                        `fetchMap ${sn}: heatmap urls image=${!!heatData.url} wifi=${!!heatData.wifiUrl} net=${!!heatData.netUrl} texture=${!!heatData.textureUrl}`,
                    );
                    this.iob.log.debug(`heatData: ${JSON.stringify(heatData)}`);
                    await this.fetchMapImage(sn, "image", heatData.url);
                    await this.fetchMapImage(sn, "wifi", heatData.wifiUrl);
                    await this.fetchMapImage(sn, "net", heatData.netUrl);
                    await this.fetchMapImage(sn, "texture", heatData.textureUrl);
                }
                meta.mapJson = await this.fetchMapJson(sn, "mapData", data.mapPathFileUrl);
                meta.pathJson = await this.fetchMapJson(sn, "pathData", data.realPathFileUlr || data.realPathFileUrl);
                const backup = await this.request(
                    "GET",
                    `/wireless_map/backup_map/get?sn=${encodeURIComponent(sn)}`,
                    this.authHeaders(),
                );
                if (
                    backup.json &&
                    backup.json.data &&
                    backup.json.data != "Timeout" &&
                    backup.json.data != "Ratelimit"
                ) {
                    this.emit("map", { sn, kind: "backup", payload: backup.json.data });
                    this.iob.log.debug(`fetchMap ${sn}: Backup-Map emitted`);
                    this.iob.log.debug(`backup: ${JSON.stringify(backup.json)}`);
                }
            }
            try {
                this.iob.log.debug(
                    `fetchMap ${sn}: Livemap rendern (mapData=${!!meta.mapJson} pathData=${!!meta.pathJson} live=${meta.livePath ? meta.livePath.length : 0})`,
                );
                const dataUrl = await this.renderLivemap(meta.mapJson, meta.pathJson, sn, meta);
                if (dataUrl) {
                    this.emit("livemap", { sn, dataUrl });
                    this.iob.log.debug(`fetchMap ${sn}: Livemap emitted (${dataUrl.length} Bytes data URL)`);
                } else {
                    this.iob.log.debug(`fetchMap ${sn}: Livemap not rendered (no geometry)`);
                }
            } catch (err) {
                this.iob.log.debug(`Livemap render ${sn}: ${err.message}`);
            }
        } finally {
            meta._mapInFlight = false;
        }
    },

    /**
     * Fetch and emit livemap data for a device S/X only.
     *
     * @param {string} sn
     */
    async fetchMapWithMqttData(sn) {
        if (this.options.apptype === "Old") {
            return;
        }
        const meta = this.deviceMeta[sn];
        if (!meta || (meta.modelClass !== "S" && meta.modelClass !== "X")) {
            this.iob.log.debug(`fetchMapMqtt ${sn}: Skip modelclass ${meta && meta.modelClass} without maps`);
            return;
        }
        try {
            if (meta._mapMqttInFlight) {
                this.iob.log.debug(`fetchMapWithMqttData ${sn}: is running`);
                return;
            }
            meta._mapMqttInFlight = true;
            this.iob.log.debug(
                `fetchMapMqtt ${sn}: Livemap rendern (mapData=${!!meta.mapJson} pathData=${!!meta.pathJsonMqtt} live=${meta.livePath ? meta.livePath.length : 0})`,
            );
            const dataUrl = await this.renderLivemap(meta.mapJson, meta.pathJsonMqtt, sn, meta);
            if (dataUrl) {
                this.emit("livemap", { sn, dataUrl });
                this.iob.log.debug(`fetchMapMqtt ${sn}: Livemap emitted (${dataUrl.length} Bytes data URL)`);
            } else {
                this.iob.log.debug(`fetchMapMqtt ${sn}: Livemap not rendered (no geometry)`);
            }
        } finally {
            meta._mapMqttInFlight = false;
        }
    },

    /**
     * Fetch a CDN-hosted JSON map asset, emit it and return the parsed object.
     *
     * @param {string} sn
     * @param {string} kind
     * @param {string} url
     */
    async fetchMapJson(sn, kind, url) {
        if (!url) {
            this.iob.log.debug(`fetchMapJson ${sn}/${kind}: No URL`);
            return null;
        }
        this.iob.log.debug(`fetchMapJson ${sn}/${kind}: GET ${String(url).slice(0, 120)}`);
        try {
            const res = await axios.get(url, { timeout: 30000, validateStatus: () => true });
            if (res.status !== 200 || res.data == null) {
                this.iob.log.debug(`fetchMapJson ${sn}/${kind}: HTTP ${res.status} empty`);
                return null;
            }
            let parsed;
            let payload;
            if (typeof res.data === "string") {
                payload = res.data;
                try {
                    parsed = JSON.parse(res.data);
                } catch {
                    parsed = null;
                }
            } else {
                parsed = res.data;
                payload = JSON.stringify(res.data);
            }
            this.emit("map", { sn, kind, payload });
            this.iob.log.debug(`fetchMapJson ${sn}/${kind}: ${payload.length} Bytes emitted`);
            return parsed;
        } catch (err) {
            let e;
            if (err.response) {
                e = err.response;
            } else if (err.request) {
                e = err.request;
            } else {
                e = err.message;
            }
            this.iob.log.error(`fetchMapJson: ${e}`);
            return null;
        }
    },

    /**
     * Fetch a CDN-hosted heatmap image and emit a data URL.
     *
     * @param {string} sn
     * @param {string} kind
     * @param {string} url
     */
    async fetchMapImage(sn, kind, url) {
        if (!url) {
            this.iob.log.debug(`fetchMapImage ${sn}/${kind}: No URL!`);
            return;
        }
        this.iob.log.debug(`fetchMapImage ${sn}/${kind}: GET ${String(url).slice(0, 120)}`);
        try {
            const res = await axios.get(url, {
                timeout: 30000,
                responseType: "arraybuffer",
                validateStatus: () => true,
            });
            if (res.status !== 200 || !res.data) {
                this.iob.log.debug(`fetchMapImage ${sn}/${kind}: HTTP ${res.status} empty!`);
                return;
            }
            const buf = Buffer.from(res.data);
            let ct = String(res.headers["content-type"] || "")
                .split(";")[0]
                .trim()
                .toLowerCase();
            if (!ct || ct === "application/octet-stream" || !ct.startsWith("image/")) {
                if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
                    ct = "image/png";
                } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
                    ct = "image/jpeg";
                } else if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
                    ct = "image/gif";
                } else if (
                    buf.length >= 12 &&
                    buf[0] === 0x52 &&
                    buf[1] === 0x49 &&
                    buf[2] === 0x46 &&
                    buf[3] === 0x46 &&
                    buf[8] === 0x57 &&
                    buf[9] === 0x45 &&
                    buf[10] === 0x42 &&
                    buf[11] === 0x50
                ) {
                    ct = "image/webp";
                } else {
                    ct = "image/png";
                }
            }
            const dataUrl = `data:${ct};base64,${buf.toString("base64")}`;
            this.emit("map", { sn, kind, payload: dataUrl });
            this.iob.log.debug(`fetchMapImage ${sn}/${kind}: ${ct}, ${buf.length} Bytes emitted`);
        } catch (err) {
            let e;
            if (err.response) {
                e = err.response;
            } else if (err.request) {
                e = err.request;
            } else {
                e = err.message;
            }
            this.iob.log.error(`fetchMapJson: ${e}`);
        }
    },

    /**
     * Create Live Map
     *
     * @param {any} mapData
     * @param {any} pathData
     * @param {string} sn
     * @param {any} [meta]
     * @returns {Promise<string|null>}
     */
    async renderLivemap(mapData, pathData, sn, meta) {
        if (!mapData || typeof mapData !== "object") {
            return null;
        }
        const PImage = loadPImage();
        if (!PImage) {
            this.emit("error", new Error("renderLivemap: optional dependency 'pureimage' missing"));
            return null;
        }
        return this.renderLivemapInner(PImage, mapData, pathData, sn, meta);
    },

    /**
     * Render a livemap (map polygons + recorded path + live MQTT path + mower
     * + charger) into a PNG data URL. Shapes are projected with a Y-flip; the
     * mower and (oriented) charger are drawn from MQTT-pushed state.
     *
     * @param {any} PImage
     * @param {any} mapData
     * @param {any} pathData
     * @param {string} sn
     * @param {any} [meta]
     * @returns {Promise<string|null>}
     */
    async renderLivemapInner(PImage, mapData, pathData, sn, meta) {
        const parsePoints = str => {
            if (!str) {
                return [];
            }
            try {
                const arr = typeof str === "string" ? JSON.parse(str) : str;
                if (!Array.isArray(arr)) {
                    return [];
                }
                return arr
                    .map(p => [Number(p[0]), Number(p[1])])
                    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
            } catch {
                return [];
            }
        };
        const settings = this.livemapSettings[sn] ? this.livemapSettings[sn] : this.livemapSettings.default;
        const groups = [
            "divide_area_work",
            "region_work",
            "region_channel",
            "region_obstacle",
            "region_forbidden",
            "region_placed_blank",
        ];
        if (settings.region_pattern_active) {
            groups.push("region_customize");
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const collected = {};
        for (const g of groups) {
            const arr = Array.isArray(mapData[g]) ? mapData[g] : [];
            collected[g] = arr.map(item => parsePoints(item.points)).filter(p => p.length > 0);
            for (const pts of collected[g]) {
                for (const [x, y] of pts) {
                    if (x < minX) {
                        minX = x;
                    }
                    if (x > maxX) {
                        maxX = x;
                    }
                    if (y < minY) {
                        minY = y;
                    }
                    if (y > maxY) {
                        maxY = y;
                    }
                }
            }
        }
        if (!Number.isFinite(minX) || maxX === minX || maxY === minY) {
            return null;
        }
        const width = maxX - minX;
        const height = maxY - minY;
        const SCALE = 25;
        const MAX_DIM = 1500;
        let canvasW = Math.max(1, Math.round(width * SCALE));
        let canvasH = Math.max(1, Math.round(height * SCALE));
        if (canvasW > MAX_DIM || canvasH > MAX_DIM) {
            const f = MAX_DIM / Math.max(canvasW, canvasH);
            canvasW = Math.max(1, Math.round(canvasW * f));
            canvasH = Math.max(1, Math.round(canvasH * f));
        }
        const transform = ([x, y]) => {
            const xn = (x - minX) / (maxX - minX);
            const yn = (y - minY) / (maxY - minY);
            return [Math.round(xn * canvasW), Math.round((1 - yn) * canvasH)];
        };
        const bitmap = PImage.make(canvasW, canvasH);
        if (bitmap.data && typeof bitmap.data.fill === "function") {
            bitmap.data.fill(0);
        }
        const ctx = bitmap.getContext("2d");

        const dedup = pts => {
            const tp = [];
            for (const p of pts) {
                const [x, y] = transform(p);
                if (tp.length === 0 || tp[tp.length - 1][0] !== x || tp[tp.length - 1][1] !== y) {
                    tp.push([x, y]);
                }
            }
            return tp;
        };

        const drawPoly = (pts, fill, stroke, lineWidth = 1) => {
            if (!pts || pts.length < 2) {
                return;
            }
            const tp = dedup(pts);
            while (tp.length > 1 && tp[tp.length - 1][0] === tp[0][0] && tp[tp.length - 1][1] === tp[0][1]) {
                tp.pop();
            }
            const minPoints = fill ? 3 : 2;
            if (tp.length < minPoints) {
                return;
            }
            ctx.beginPath();
            ctx.moveTo(tp[0][0], tp[0][1]);
            for (let i = 1; i < tp.length; i++) {
                ctx.lineTo(tp[i][0], tp[i][1]);
            }
            ctx.closePath();
            if (fill) {
                ctx.fillStyle = fill;
                ctx.fill();
            }
            if (stroke) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = lineWidth;
                ctx.stroke();
            }
        };

        const drawPolyline = (worldPts, color, lineWidth = 1) => {
            if (!Array.isArray(worldPts) || worldPts.length < 2) {
                return;
            }
            const pp = [];
            for (const e of worldPts) {
                if (!Array.isArray(e) || e.length < 2) {
                    continue;
                }
                const [px, py] = transform([e[0], e[1]]);
                if (pp.length === 0 || pp[pp.length - 1][0] !== px || pp[pp.length - 1][1] !== py) {
                    pp.push([px, py]);
                }
            }
            if (pp.length < 2) {
                return;
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(pp[0][0], pp[0][1]);
            for (let i = 1; i < pp.length; i++) {
                ctx.lineTo(pp[i][0], pp[i][1]);
            }
            ctx.stroke();
        };

        // Oriented arrow head at world (x, y) with world-frame angle (radians).
        // Tip points along the world +X axis at angle 0; positive angle rotates
        // counter-clockwise in world space (Y-flip during transform).
        const drawArrow = (worldX, worldY, angle, size, fill, stroke) => {
            const [cx, cy] = transform([worldX, worldY]);
            const a = Number.isFinite(angle) ? angle : 0;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const local = [
                [size, 0],
                [-size * 0.6, size * 0.5],
                [-size * 0.6, -size * 0.5],
            ];
            const pts = local.map(([lx, ly]) => {
                const wx = lx * cos - ly * sin;
                const wy = lx * sin + ly * cos;
                return [Math.round(cx + wx), Math.round(cy - wy)];
            });
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.lineTo(pts[2][0], pts[2][1]);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        for (const pts of collected.region_channel) {
            drawPoly(
                pts,
                settings.region_channel_fill,
                settings.region_channel_stroke,
                settings.region_channel_lineWidth,
            );
        }
        for (const pts of collected.region_work) {
            drawPoly(pts, settings.region_work_fill, settings.region_work_stroke, settings.region_work_lineWidth);
        }
        for (const pts of collected.region_forbidden) {
            drawPoly(
                pts,
                settings.region_forbidden_fill,
                settings.region_forbidden_stroke,
                settings.region_forbidden_lineWidth,
            );
        }
        for (const pts of collected.region_placed_blank) {
            drawPoly(
                pts,
                settings.region_placed_blank_fill,
                settings.region_placed_blank_stroke,
                settings.region_placed_blank_lineWidth,
            );
        }
        for (const pts of collected.divide_area_work) {
            drawPoly(pts, null, settings.divide_area_work_stroke, settings.divide_area_work_lineWidth);
        }
        for (const pts of collected.region_obstacle) {
            drawPoly(
                pts,
                settings.region_obstacle_fill,
                settings.region_obstacle_stroke,
                settings.region_obstacle_lineWidth,
            );
        }
        if (settings.region_pattern_active) {
            for (const pts of collected.region_customize) {
                drawPoly(
                    pts,
                    settings.region_pattern_fill,
                    settings.region_pattern_stroke,
                    settings.region_pattern_lineWidth,
                );
            }
        }
        if (Array.isArray(pathData)) {
            drawPolyline(pathData, settings.polyline_color, settings.polyline_lineWidth);
        }
        const livePath = meta && Array.isArray(meta.livePath) ? meta.livePath : null;
        if (livePath && livePath.length >= 2) {
            drawPolyline(livePath, settings.polyline_color, settings.polyline_lineWidth);
        }

        // Sprites once (cached). If missing, fall back to drawArrow.
        const robotSprite = await loadSprite(PImage, settings.robot_path, _robotSprite).catch(() => null);
        const chargerSprite = await loadSprite(PImage, settings.charger_path, _chargerSprite).catch(() => null);
        const spriteScale = (canvasW + canvasH) / settings.robot_charger_scale / 1000;

        const drawSprite = (sprite, worldX, worldY, angleRad) => {
            const [cx, cy] = transform([worldX, worldY]);
            const w = Math.max(1, Math.round(sprite.width * spriteScale));
            const h = Math.max(1, Math.round(sprite.height * spriteScale));
            ctx.save();
            ctx.translate(cx, cy);
            // PNG points "up" by default; angle is canvas-CW. The Y-flip in
            // transform() inverts the rotation sense, so negate here.
            ctx.rotate(-(Number.isFinite(angleRad) ? angleRad : 0));
            ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height, -w / 2, -h / 2, w, h);
            ctx.restore();
        };

        // Charger: prefer MQTT-pushed pos, fall back to static map data.
        let chargerWorld = null;
        let chargerAngle = 0;
        if (meta && meta.chargerPos) {
            chargerWorld = [meta.chargerPos.x, meta.chargerPos.y];
            chargerAngle = meta.chargerPos.angle || 0;
        } else if (mapData.charge_pos && Array.isArray(mapData.charge_pos.point)) {
            const pt = mapData.charge_pos.point;
            if (pt.length >= 2 && (pt[0] !== 0 || pt[1] !== 0)) {
                chargerWorld = [Number(pt[0]), Number(pt[1])];
                chargerAngle = Number(mapData.charge_pos.angle) || 0;
            }
        }
        if (chargerWorld && Number.isFinite(chargerWorld[0]) && Number.isFinite(chargerWorld[1])) {
            if (chargerSprite) {
                drawSprite(chargerSprite, chargerWorld[0], chargerWorld[1], chargerAngle);
            } else {
                drawArrow(chargerWorld[0], chargerWorld[1], chargerAngle, 9, "rgba(255,200,0,1)", "rgba(0,0,0,1)");
            }
        }

        // Mower (only available via MQTT).
        if (meta && meta.robotPos && Number.isFinite(meta.robotPos.x) && Number.isFinite(meta.robotPos.y)) {
            if (robotSprite) {
                drawSprite(robotSprite, meta.robotPos.x, meta.robotPos.y, meta.robotPos.angle || 0);
            } else {
                drawArrow(
                    meta.robotPos.x,
                    meta.robotPos.y,
                    meta.robotPos.angle || 0,
                    10,
                    "rgba(255,0,0,1)",
                    "rgba(0,0,0,1)",
                );
            }
        }

        const chunks = [];
        const sink = new Writable({
            write(chunk, _enc, cb) {
                chunks.push(Buffer.from(chunk));
                cb();
            },
        });
        await PImage.encodePNGToStream(bitmap, sink);
        const buf = Buffer.concat(chunks);
        return `data:image/png;base64,${buf.toString("base64")}`;
    },
};
