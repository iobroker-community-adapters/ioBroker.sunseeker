![Logo](admin/sunseeker.png)

# ioBroker.sunseeker

[![NPM version](https://img.shields.io/npm/v/iobroker.sunseeker.svg)](https://www.npmjs.com/package/iobroker.sunseeker)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sunseeker.svg)](https://www.npmjs.com/package/iobroker.sunseeker)
![Number of Installations](https://iobroker.live/badges/sunseeker-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/sunseeker-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.sunseeker.png?downloads=true)](https://www.npmjs.com/package/iobroker.sunseeker)

**Tests:** ![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.sunseeker/workflows/Test%20and%20Release/badge.svg)

## Sunseeker mower adapter for ioBroker

Connects Sunseeker robotic lawn mowers (also rebranded as Adano, Brücke, etc.) to ioBroker through the official Sunseeker cloud. Both the legacy (`Old`) and current (`New`) Sunseeker APIs are supported, covering the S, X, V and V1 model classes.

## No ioBroker / Home Assistant / framework dependency.

🇬🇧 [Readme](/lib/sunseeker/README.md)

## Requirements

- ioBroker js-controller `>= 6.0.11`
- Admin `>= 7.8.23`
- Node.js `>= 22`
- Sunseeker cloud account (e-mail + password, same as in the mobile app)

## API overview

| Area                  | Endpoints                                                                                                                                                                                                                                                                | Used?                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Auth                  | `POST /auth/oauth/token` (login + refresh), `auth/mobile/token/social`                                                                                                                                                                                                   | Yes                                |
| Device list           | `GET /app_wireless_mower/device-user/getCustomDevice`, `…/list`, `…/{id}`, `…/remark`                                                                                                                                                                                    | Yes (`getCustomDevice`)            |
| Status                | `GET /app_wireless_mower/device/getBysn`, `…/info/{id}`, `…/check`, `…/readWeakSignal`, `…/getSignalType`                                                                                                                                                                | Yes (`getBysn`)                    |
| Settings (read)       | `GET /app_wireless_mower/device-setting/{sn}`, `…/getTime/{sn}`, `device/getDeviceSettingBySn`, `device-configuration/getBySn/{sn}`, `device-model/getByClientName`                                                                                                      | Yes (`device-setting/{sn}`)        |
| Settings (write, New) | `POST /iot_mower/wireless/device/set_property` (S/X/V), `POST /app_wirelessv1_mower/wirelessv1/device/setProperty` (V1), `POST /app_wireless_mower/device/setRain/{sn}/{appId}`, `…/setWifi`, `…/appEditDevice`                                                          | Partial (`set_property` for blade) |
| Settings (write, Old) | `POST /app_mower/device-setting/save`, `…/updateLocation`, `…/updateTimeZone`, `device/setLed`, `…/saveLed`, `…/setRain`, `…/saveRain`, `…/setUltra`, `…/saveUltra`, `…/setZones`, `…/setNickName`, `…/setGps`, `…/setCurrentTime`, `…/setWorkStatus`, `…/resetPassword` | No                                 |
| Schedule              | `POST /app_mower/device-schedule/setScheduling` (Old), `app_mower/device-schedule/save`, `app_mower/device/getScheduling`, `POST /app_wireless_mower/.../setProperty` with `setSchedule` (V1) and `set_property` with `setTimeTactics` (S/X/V)                           | Yes (all three paths)              |
| MQTT proxy via REST   | `POST /iot_mower/wireless/device/get_property`, `…/set_property`, `…/action`, `…/extra`, `…/otaUpgrade`, `…/bindBaseStation`                                                                                                                                             | Yes (`get_property` after connect) |
| Maps                  | `GET /wireless_map/wireless_device/get`, `…/getHeatMap`, `…/get3D`, `wireless_map/backup_map/get`, `map/work-map/mobile/{sn}`, `…/newest/{online}/{sn}`, `…/all-info`, `app_wireless_mower/device/getMapRealPath`                                                        | Yes (`get` + `getHeatMap`)         |
| Work records          | `GET /app_wireless_mower/work_record/page`, `…/work_event_info/page`, `device_log/device-operation-records/esPage`, `app_mower/device-record/getRecord/{sn}`, `app_mower/device-cmd-logs/page`                                                                           | Yes (`get` + `work_record/page`)   |
| Anti-theft / GPS      | `gps/mobile/anti-theft/by-sn/{sn}`, `…/device-position/{sn}`, `…/getAntiTheftStatusInfo`, `…/is-it-bound`, `…/set-fence`, `…/wireless/bind`, `gps/anti-theft/send-track`, `gps/fence-radius-setting/list`                                                                | No                                 |
| Base station          | `station/base-station/bind`, `…/unBind`, `…/getByDeviceSn`, `…/getByStationSn/{sn}`                                                                                                                                                                                      | No                                 |
| OTA                   | `ota/firmware-large/check/{sn}/{ver}`, `…/getDescription`, `…/otaUpdate`, `…/wireless/check`, `ota/firmware-small/list/{id}`                                                                                                                                             | No                                 |
| Sharing               | `app_wireless_mower/device-user-share`, `…/invite/detail`, `…/invite/reply`, `…/unbind`, `device-user/openShare`, `…/closeShare`                                                                                                                                         | No                                 |
| Skins / cosmetics     | `app_wireless_mower/device-skin`, `…/list`, `…/bind/switch{userId}/{id}`                                                                                                                                                                                                 | No                                 |
| Payment               | `pay/v1/mobile/combo/*`, `pay/v1/mobile/order/*`, `pay/v1/paypal/*`, `pay/v1/user/card/holder*`                                                                                                                                                                          | No                                 |
| Misc                  | `app_wireless_mower/feedback-record`, `community_activities/*`, `message-send-logs/*`, `app-version/check`, `app-agreements/business-types/{type}/items`, `sale/manual/getManualBySn`, `link-address/list/{type}`                                                        | No                                 |

V1-specific (`app_wirelessv1_mower/wirelessv1/`): `device-setting`, `device-setting/{sn}`, `device-schedule/{deviceId}`, `device/getProperty`, `device/setProperty`, `device/saveProperty`, `device/restoreFactory`.

## Configuration

- `New`: all S, X, V and V1 series mowers (server `wirefree-specific.sk-robot.com` / `wirefree-specific-us.sk-robot.com`)
- `Old`: older devices without Wirefree branding (server `server.sk-robot.com`)

## Features

- REST login (OAuth2 password grant) with automatic token refresh on a single `setInterval`.
- Per-account device list and status/settings polling at the configured interval.
- MQTT push:
    - `New` API: TLS MQTT (port 1884 for SXV, 32884 for V1) with an RSA-encrypted password. After connect the adapter triggers `getDevAllProperties`, `getSelectRegionID`, `getAllPath`, `getConsumableItems` and `getFcState` via `get_property` POST so the full state is available immediately.
    - `Old` API: plain MQTT on `mqtts.sk-robot.com:1883` with the hard-coded app user.
- Model classification into `S`, `X`, `V` (incl. V18/V3) and `V1`. Endpoints and parameters (`cmdurl`, border mode, set-property path) are picked automatically.
- Translated event codes: 12 language variants from the Home Assistant lang files are bundled in `lib/eventcodes.json` and attached as `common.states` to `event_code` and `errortype` (model-aware) so the ioBroker UI shows readable labels.

## Writable settings

These settings are made writable directly under `<sn>.settings.*`. Writing them sends a `set_property` / `setProperty` (model-dependent)
When writing blade values, the adapter posts `{ id: "setDevBlade", key: "blade", method: "set_property", speed|height: <int> }`. After 1.5 s a status refresh is scheduled; MQTT push usually updates the values as well.

Writing `rainFlag` or `rainDelayDuration` always sends both values to the cloud (the missing one is read from the current state). The endpoint depends on the model:

- `Old`: `POST /app_mower/device/setRain/{sn}/{appId}` with `rainFlag` + `rainDelayDuration`.
- `New` V1: `POST {cmdurl}setProperty` with `method: "setRain"`, `rainFlag`, `rainDelayDuration`.
- `New` S/X/V: `POST {cmdurl}set_property` with `id: "setDevRain"`, `key: "rain"`, `rain_flag`, `delay`.

## Schedule (`<sn>.schedule.*`)

A simple weekly plan with one window per day. The states are writable but the cloud is only updated when `set` is triggered.
The dispatched payload depends on the model:

- `Old` API: `POST /app_mower/device-schedule/setScheduling` with `deviceScheduleBOS` for all 7 days; `autoFlag` is the inverse of `pause`.
- `New` V1: `POST {cmdurl}setProperty` with `method: "setSchedule"` and `deviceScheduleBOS` containing only the active days.
- `New` S/X/V: `POST {cmdurl}set_property` with `id: "setTimeTactics"`, `key: "time_tactics"` and a `time` array (one entry per active day, day index Mon=1…Sat=6, Sun=0; start/end as seconds since midnight).

## Known limitations

The Sunseeker API exposes far more fields than the adapter currently writes. All settings are available read-only as raw data under `<sn>.settings`.

## References

- Home Assistant integration used as the API reference: <https://github.com/Sdahl1234/Sunseeker-lawn-mower>
- json2iob: <https://github.com/TA2k/json2iob>
- Sunseeker (wireless): <https://sunseekertech.com>
- Scheppach (wire): <https://shop.scheppach.com/Produkte/Garten-Hof/Rasenmaeher/Rasenmaehroboter/>
- Texas (wire): <https://texas-gartentechnik.eu/Sortiment/Maehroboter/>
- Adano (wire): <https://schou.com/en/pages/robotplaeneklippere>
- Brücke (wire): No HP
- Orbex (wire): No HP
- Grouw (wire): <https://schou.com/en/pages/robotplaeneklippere>

## Description

🇬🇧 [Description](/docs/en/README.md)</br>
🇩🇪 [Beschreibung](/docs/de/README.md)

## Questions

🇩🇪 [Fragen](https://forum.iobroker.net/topic/85407/test-adapter-sunseeker-v0.0.2)

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
- (copilot) Adapter requires node.js >= 22.19.0 now

- (Lucky-ESA) Adaptation for the S5-Gen-2 mower

### 0.0.5 (2026-10-24)

- (Lucky-ESA) MQTT reconnected fixed

### 0.0.4 (2026-10-18)

- (Lucky-ESA) Added account sharing
- (Lucky-ESA) Added device sorting

### 0.0.3 (2026-10-11)

- (Lucky-ESA) Settings added
- (Lucky-ESA) Refresh properties button added
- (Lucky-ESA) Multi-angle added
- (Lucky-ESA) Custom Multi-angle added
- (Lucky-ESA) Mirroring of App version 1.7.0 regarding login, header, and MQTT password.
- (Lucky-ESA) Pattern, anti-theft added

### 0.0.2 (2026-05-29)

- (ioBroker-Bot) Adapter requires admin >= 7.8.23 now.
- (Lucky-ESA) Added event log

### 0.0.1 (2026-05-15)

- (TA2k) initial release

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

MIT License

Copyright (c) 2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2026 TA2k <tombox2020@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
