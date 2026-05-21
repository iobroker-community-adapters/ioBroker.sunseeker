![Logo](admin/sunseeker.png)

# ioBroker.sunseeker

[![NPM version](https://img.shields.io/npm/v/iobroker.sunseeker.svg)](https://www.npmjs.com/package/iobroker.sunseeker)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sunseeker.svg)](https://www.npmjs.com/package/iobroker.sunseeker)
![Number of Installations](https://iobroker.live/badges/sunseeker-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/sunseeker-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.sunseeker.png?downloads=true)](https://nodei.co/npm/iobroker.sunseeker/)

**Tests:** ![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.sunseeker/workflows/Test%20and%20Release/badge.svg)

## Sunseeker mower adapter for ioBroker

Connects Sunseeker robotic lawn mowers (also rebranded as Adano, Brücke, etc.) to ioBroker through the official Sunseeker cloud. Both the legacy (`Old`) and current (`New`) Sunseeker APIs are supported, covering the S, X, V and V1 model classes.

## Requirements

- ioBroker js-controller `>= 6.0.11`
- Admin `>= 7.0.23`
- Node.js `>= 22`
- Sunseeker cloud account (e-mail + password, same as in the mobile app)

## Configuration

The adapter settings expose the following fields:

| Field | Description |
| --- | --- |
| Username / e-mail | Sunseeker app login |
| Password | Sunseeker app password (stored encrypted) |
| Region | `EU` or `US` (only relevant for the `New` API) |
| API | `New` for current models (S/X/V/V1), `Old` for older devices |
| Polling interval | REST poll interval in seconds (minimum 30) |
| Language | UI and event-code language, e.g. `de-DE`, `en-EN` |

Which API to pick depends on the model:

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

## Object tree

For each mower (serial `<sn>`) the adapter creates these channels:

- `<sn>.list` — raw device info from the device list
- `<sn>.status` — mower status (poll **and** MQTT push write into the same folder)
- `<sn>.settings` — device settings
- `<sn>.remote` — command buttons

Raw payloads (REST and MQTT) are written through `json2iob` directly — no parallel adapter-side data model is maintained.

## Commands (`<sn>.remote.*`)

| State | Effect |
| --- | --- |
| `start` | Start mowing |
| `pause` | Pause |
| `dock` | Return to charging station |
| `stop_find_charger` | Cancel return-to-dock |
| `border` | Border cut (V models: mode 5 with `value:true`) |
| `stop` | Stop |
| `stop_task` | Cancel current task |
| `restart` | Restart task |
| `refresh` | Reload status now |

## Writable settings

These settings are made writable directly under `<sn>.settings.*`. Writing them sends a `set_property` / `setProperty` (model-dependent) request to the cloud:

| State | Range | Unit |
| --- | --- | --- |
| `bladeSpeed` | 2800 – 3000 (step 100) | rpm |
| `bladeHeight` | 20 – 100 (step 5) | mm |

When writing, the adapter posts `{ id: "setDevBlade", key: "blade", method: "set_property", speed|height: <int> }`. After 1.5 s a status refresh is scheduled; MQTT push usually updates the values as well.

## Schedule (`<sn>.schedule.*`)

A simple weekly plan with one window per day. The states are writable but the cloud is only updated when `set` is triggered.

| State | Type | Format |
| --- | --- | --- |
| `monday` … `sunday` | string | `"HH:MM-HH:MM"` for the active window, empty string disables the day |
| `pause` | boolean | Pause the schedule without clearing the windows |
| `set` | button | Sends the current values to the cloud |

The dispatched payload depends on the model:

- `Old` API: `POST /app_mower/device-schedule/setScheduling` with `deviceScheduleBOS` for all 7 days; `autoFlag` is the inverse of `pause`.
- `New` V1: `POST {cmdurl}setProperty` with `method: "setSchedule"` and `deviceScheduleBOS` containing only the active days.
- `New` S/X/V: `POST {cmdurl}set_property` with `id: "setTimeTactics"`, `key: "time_tactics"` and a `time` array (one entry per active day, day index Mon=1…Sat=6, Sun=0; start/end as seconds since midnight).

## Known limitations

The Sunseeker API exposes far more fields than the adapter currently writes. All settings are available read-only as raw data under `<sn>.settings`. The following are **not yet** exposed as writable states:

- Rain delay (on/off, hours)
- Zone settings (per-zone blade speed/height, ordering)
- OTA update
- Work records / mowing history
- V1-specific settings: return path, screen lock, border distance, schedule on/off
- Gen2 settings: auto_ride_edge, energy_save, night_work
- AI sensitivity, PIN code, map operations

## References

- Home Assistant integration used as the API reference: <https://github.com/Bouni/sunseeker-lawn-mower>
- json2iob: <https://github.com/TA2k/json2iob>

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

### 0.0.1

- (TA2k) initial release

## License

MIT License

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
