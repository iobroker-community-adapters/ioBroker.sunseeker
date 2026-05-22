# sunseeker-client

Pure Node.js client for the Sunseeker robotic-mower cloud. Wraps the official REST endpoints and the MQTT push channel for `S`, `X`, `V`, `V1` and the legacy ("Old") product line.

No ioBroker / Home Assistant / framework dependency. Drop the folder into any Node project (or `npm install ./lib/sunseeker`) and use directly.

## Install

```bash
npm install axios mqtt
# Optional, only needed for renderLivemap():
npm install pureimage
```

## Usage

```js
const Sunseeker = require("./lib/sunseeker");

const client = new Sunseeker("user@example.com", "secret", {
    region: "EU",       // EU | US
    apptype: "New",     // New (S/X/V/V1) | Old (legacy)
    language: "de-DE",
    interval: 60,       // poll seconds
    logger: console,
});

client.on("devices", ({ devices }) => console.log("devices:", devices.length));
client.on("status", ({ sn, status, settings }) => { /* … */ });
client.on("mqtt", ({ sn, topic, data }) => { /* … */ });
client.on("map", ({ sn, kind, payload }) => { /* kinds: info, image, wifi, net, texture, mapData, pathData, backup */ });
client.on("livemap", ({ sn, dataUrl }) => { /* PNG data URL */ });
client.on("mqttConnect", () => {});
client.on("mqttDisconnect", () => {});
client.on("error", err => console.error(err));

await client.start();           // login + getDevices + initMqtt + startPolling
// …or call client.login(), client.getDevices(), client.startMqttNew(), client.startPolling() yourself.

await client.sendCommand(sn, "start");
await client.setBlade(sn, "speed", 2900);
await client.setRain(sn, true, 60);
await client.setSchedule(sn, { monday: "08:00-12:00", pause: false /* … */ });

client.stop();                  // clears all timers + closes MQTT
```

## API surface

- Lifecycle: `start()`, `stop()`
- Auth: `login()`, `refreshToken()`, `request(method, path, headers, data)`
- Devices: `getDevices()`, `classifyModel(modelName)`, `getEventCodes(modelClass)`
- Polling/Settings: `startPolling()`, `stopPolling()`, `updateAllDevices()`, `updateDevice(sn)`, `sendCommand(sn, cmd, value?)`, `setBlade(sn, key, value)`, `setRain(sn, flag, durationMin)`, `setSchedule(sn, plan)`
- MQTT: `startMqttNew()`, `startMqttOld()`, `getDeviceProperty(sn, body)`, `fetchInitialProperties()`
- Map: `fetchMap(sn)`, `renderLivemap(mapData, pathData, meta)`

## Events

| Event           | Payload                                         | Notes                                                |
| --------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `devices`       | `{ devices: object[] }`                         | After successful `getDevices()`.                     |
| `status`        | `{ sn, status, settings }`                      | `settings` may be missing on partial fetches.        |
| `mqtt`          | `{ sn, topic, data }`                           | Parsed JSON of the MQTT message.                     |
| `map`           | `{ sn, kind, payload }`                         | See kinds above.                                     |
| `livemap`       | `{ sn, dataUrl }`                               | Rendered PNG, requires optional `pureimage`.         |
| `mqttConnect`   | —                                               | After broker handshake.                              |
| `mqttDisconnect`| —                                               | On socket close.                                     |
| `error`         | `Error`                                         | Background errors. Register a listener.              |

## Notes

- All timers are native (`setInterval` / `setTimeout`).
- `pureimage` is loaded lazily inside `renderLivemap`; if it's not installed the renderer emits an `error` and returns `null`.
- `eventcodes.json` ships next to the code (12 language variants).
