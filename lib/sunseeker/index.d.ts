// Type declarations for the Sunseeker client class. The class body is composed
// at runtime via Object.assign(prototype, ...mixins) in main.js, which the JS
// type-checker can't see — these declarations mirror the real surface.

import { EventEmitter } from "node:events";

interface SunseekerOptions {
    region: string;
    apptype: string;
    language: string;
    interval: number;
    refreshAfterMqttMs: number;
    logger?: Logger;
}

interface Logger {
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
    debug: (m: string) => void;
}

interface Timers {
    setTimeout: (c: any, t: number) => void;
    clearTimeout: (x: any) => void;
    setInterval: (c: any, t: number) => void;
    clearInterval: (x: any) => void;
    delay: (ms: number) => Promise<void>;
}

interface Mail {
    appType: number;
    appVersion: string;
    code: string;
    newUserName: string;
    operatingSystemCode: string;
    randomStr: string;
}

interface GMT {
    tz: string;
    gmt: string;
    gmtShort: string;
}
declare class Sunseeker extends EventEmitter {
    constructor(username: string, password: string, options?: SunseekerOptions, iob: ioBroker.Adapter | null);

    username: string;
    password: string;
    iob: ioBroker.Adapter | Timers | null;
    options: SunseekerOptions;
    log: Logger;

    session: any;
    devicesRaw: Record<string, any>;
    deviceMeta: Record<string, any>;
    devicesId: Record<string, string>;
    mqttClientV1: any;
    mqttClient: any;
    mqttOldClient: any;
    topUp: boolean;
    standalone: boolean;
    topUpArrayDeviceSn: string[];
    mqttPassword: string | undefined;
    appId: string | undefined;
    mqttsPasswordFlag: boolean;
    mqttsPasswordFlagV1: boolean;
    mqttWirefreeDomain: string | undefined;
    eventCodes: Record<string, string>;
    v1EventCodes: Record<string, string>;
    unloading: boolean;
    statusMqtt: boolean;
    statusMqttV1: boolean;
    requestLimit: Record<string, string>;
    maxRequest: number;
    errorlimit: number;

    start(): Promise<boolean>;
    stop(): void;
    getEventCodes(modelClass: string): Record<string, string>;

    // auth.js
    getBase(): { url: string; host: string };
    authHeaders(): Record<string, string>;
    request(
        method: string,
        urlPath: string,
        headers: Record<string, string>,
        data?: any,
    ): Promise<{ status: number; json: any }>;
    login(): Promise<void>;
    refreshToken(): Promise<void>;
    encryptRsa(plaintext: string): string;
    randomString(len: number): string;
    ensureAppId(): Promise<string>;
    getAppUserInfo(): Promise<any>;
    editMqttPassword(): Promise<void>;
    ownRequest(sn: string, data: any): Promise<void>;
    requestLimitCheck(method: string | undefined | null, urlPath: string | undefined | null, data: any): Promise<void>;
    getImages(url: string): Promise<void>;
    changePassword(oldPw: string, newPw: string): Promise<boolean>;
    checkEmail(mail: string): Promise<boolean>;
    uuidv4(): string;
    createVerifyCode(mail: string, random: string): Promise<boolean>;
    changeEmail(data: Mail): Promise<boolean>;
    getGmtOffset(latitude: number, longitude: number): GMT | null;
    setCountry(data: string): Promise<boolean>;
    registerIoBroker(): Promise<boolean>;

    // devices.js
    loadEventCodes(language: string): void;
    classifyModel(modelName: string): "S" | "X" | "V" | "V1";
    mqttBroker(device: boolean): { host: string; port: number } | null;
    getDevices(): Promise<any[]>;
    getEvents(sn: string, current: number, size: number): Promise<void>;
    setScheduleInfo(sn: string, data: any): void;
    setScheduleMode(sn: string, mode: number): void;
    readLivemapSettings(sn: string): Promise<void>;
    setLiveSettings(sn: string, value: ioBroker.State | null | undefined, attribut: string): void;
    changeAttributeName(data: any): void;
    getUpdateDevices(): Promise<void>;
    getUpdateSharing(): Promise<void>;
    hexToRGBA(hex: string | boolean | number): void;
    patternSize(pattern: string): Promise<number>;
    function_checks(): void;
    function_check(sn: string, check: string): Promise<boolean>;

    // polling-and-settings.js
    startPolling(): void;
    stopPolling(): void;
    updateAllDevices(first: boolean): Promise<void>;
    updateDevice(sn: string): Promise<void>;
    sendCommand(sn: string, command: string, value?: any): Promise<void>;
    setBlade(sn: string, key: "speed" | "height", value: number): Promise<boolean>;
    setSettings(sn: string, value: any, id: string, key: string, addValue: any): Promise<boolean>;
    setRain(sn: string, flag: boolean, durationMin: number): Promise<boolean>;
    setSchedule(sn: string, plan: Record<string, any>, plan2: Record<string, any>): Promise<boolean>;
    parseScheduleDay(value: string): { startSec: number; endSec: number } | null;
    secToHms(sec: number): string;
    setMowEfficiency(sn: string, gap: number, speed: number): Promise<boolean>;
    changePin(sn: string, oldpin: string, newpin: string): Promise<boolean>;
    ota_upgrade(sn: string): Promise<void>;
    ota_base_upgrade(sn: string): Promise<void>;
    startUpdateCheck(first: boolean): Promise<void>;
    startUpdateCheckInterval(): Promise<void>;
    setPlanMode(sn: string, mode: number, angle: any): Promise<boolean>;
    setDeviceName(sn: string, val: ioBroker.State | null | undefined): Promise<boolean>;
    setAutoUpgrade(sn: string, val: ioBroker.State | null | undefined): Promise<boolean>;
    setNotice(sn: string, data: any): Promise<void>;
    getNotice(sn: string): Promise<void>;
    setMarkAllAsRead(sn: string): Promise<boolean>;
    getScheduleX(sn: string): Promise<void>;
    getInfo(sn: string): Promise<void>;
    setPatternExpirationTime(sn: string, value: number): Promise<boolean>;
    createFence(sn: string): Promise<void>;
    updateTheft(sn: string): Promise<void>;
    setAntiTheftX(data: any): Promise<boolean>;
    setRemark(id: string, sn: string, data: any): Promise<boolean>;
    deleteDevice(id: string, sn: string, deviceId: string, devSn: string, obj: any, noneId: string): Promise<boolean>;
    sendShareRequest(id: string, objId: string, sn: string, mail: string): Promise<boolean>;
    setUnbind(sn: string, data: any, objId: string): Promise<boolean>;
    acceptShareApplyInvite(id: string, val: string, obj: any, sn: string, data: any): Promise<boolean>;
    setTopUp(id: string, sn: string, snList: any[], type: number): Promise<boolean>;
    delay(ms: number): Promise<void>;
    messageMakeRead(sn: string, messageId: string): Promise<boolean>;
    getDeviceSkin(sn: string): Promise<boolean>;
    getCommunityActivities(sn: string): Promise<boolean>;
    getErrorMessage(sn: string, type: string, detail: number, model: string, base: number): Promise<boolean>;
    getAgreements(sn: string): Promise<boolean>;
    getSettingsX(sn: string): Promise<boolean>;
    getScheduleX(sn: string): Promise<boolean>;
    getSharingUser(sn: string, id: string): Promise<boolean>;
    checkAppUpdate(type: string, version: string): Promise<boolean>;
    deleteMessages(ids: string[]): Promise<boolean>;
    setProfile(sn: string): Promise<boolean>;

    // mqttV1.js
    connectMqttV1(): void;
    scheduleMqttRetryV1(): void;

    // mqtt.js
    initMqtt(): void;
    startMqttNew(device: boolean): Promise<void>;
    connectMqtt(): void;
    scheduleMqttRetry(): void;
    startMqttOld(): void;
    onMqttMessage(topic: string, payload: Buffer): void;
    absorbLivemapState(meta: any, statusData: any): void;
    getDeviceProperty(sn: string, body: any): Promise<void>;
    setDeviceProperty(sn: string, body: any): Promise<boolean>;
    fetchInitialProperties(): Promise<void>;
    setLiveMap(sn: string, val: boolean): void;
    fetchAllProperties(sn: string): Promise<void>;
    liveMapHandler(sn: string, data: any, event: "change" | "path"): Promise<void>;
    isWorking(sn: string, data: any): void;
    getMapTempName(sn: string): void;

    // map.js
    fetchMap(sn: string): Promise<void>;
    fetchMapJson(sn: string, kind: string, url: string): Promise<any>;
    fetchMapImage(sn: string, kind: string, url: string): Promise<void>;
    renderLivemap(mapData: any, pathData: any, meta?: any): Promise<string | null>;
    fetchMapWithMqttData(sn: string): Promise<void>;

    // map_preview.js
    fetchMapPreview(sn: string, region: string, map: any): Promise<void>;

    // helper.js
    createSettings(sn: string, data: any): Promise<void>;
    createSettingsFW(sn: string): Promise<void>;
    ensureRemoteButtons(sn: string): Promise<void>;
    ensureScheduleStates(sn: string): Promise<void>;
    ensureOwnRequestStates(sn: string): Promise<void>;
    createDataPoint(
        ident: string,
        common: any,
        types: "state" | "folder" | "channel" | "device",
        value: string | number | boolean | null | undefined,
        extend: boolean | null | undefined,
        native: any,
    ): Promise<void>;
    setStates(sn: string, data: any, isAvailable: any): Promise<void>;
    addDeleteObject(
        sn: string,
        data: any,
        objChannel: string,
        objName: string,
        lang: any,
        name: any,
        isAvailable: any,
    ): Promise<void>;
    createLivemapSettings(sn: string): Promise<void>;
    createCustomMultiAngle(sn: string, path: string): Promise<void>;
    setCustomMultiAngle(sn: string, data: any, path: string): Promise<void>;
    availableMessageSettings(message: string): Promise<any>;
    addSharing(sn: string): Promise<any>;
    updateShareApplyInvite(sn: string, states: any, extend: boolean | null): Promise<void>;
    addTopUp(sn: string, isAvailable: any): Promise<void>;
    ensureProfileStates(): Promise<void>;
    ensureProfileStatesSN(sn: string): Promise<void>;
    timezoneValue(): any;
    timezoneCode(): any;
    getRegionISO(): any;
}

export = Sunseeker;
