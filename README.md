# LuxConnect

TypeScript OPC UA client for [B&R mapp Connect](https://www.br-automation.com/). Connect to a controller, subscribe to variables, and get real-time updates with one class. Works in Node.js and modern browsers.

> Status: pre-1.0. The core API (`OpcuaMachine`) is stable; surrounding utilities may still change.

## Install

```bash
npm install @loupeteam/lux-connect
```

## Quick start

```typescript
import { OpcuaMachine } from '@loupeteam/lux-connect';

const machine = new OpcuaMachine({
  host: 'localhost',
  port: 8443,
  protocol: 'https',
  username: 'admin',
  password: 'password',
});

await machine.connect();

// Subscribe to a variable; the callback fires whenever the value changes.
machine.initCyclicRead('Temperature', (value) => {
  console.log('Temperature:', value);
});

// One-shot read and write.
const pressure = await machine.readVariable('Pressure');
await machine.writeVariable('SetPoint', 25.5);
```

That's the full happy path. The rest of this doc explains each piece.

## Connection configuration

`new OpcuaMachine(config)` takes a `ConnectionConfig`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | (required) | mapp Connect server hostname or IP |
| `port` | number | `80` / `443` | HTTP port for mapp Connect |
| `protocol` | `'http'` \| `'https'` | `'https'` | |
| `wsProtocol` | `'ws'` \| `'wss'` | matches `protocol` | Override if your reverse proxy differs |
| `endpointUrl` | string | `opc.tcp://<host>:4840` | OPC UA endpoint the server should connect to |
| `username` | string | — | Omit for anonymous |
| `password` | string | — | |
| `sessionTimeout` | ms | `30000` | OPC UA session timeout |
| `keepAliveInterval` | ms | `20000` | HTTP keep-alive ping interval |
| `enableWebSocket` | boolean | `true` | Required for subscriptions/change events |
| `taskNameMaxLength` | number | — | Truncate task names in nodeIds (mapp Connect's nodeId length limit) |
| `logger` | `Logger` | `consoleLogger` | Pass `silentLogger` to mute, or your own |
| `sessionStore` | `SessionStore` \| `false` | `LocalStorageSessionStore` in browsers, `InMemorySessionStore` in Node | `false` disables session persistence |

## Variable names

mapp Connect addresses variables as `Application::Task:Variable.Field[Index]`. LuxConnect accepts that full form, or shortcuts when you set defaults:

```typescript
machine.setDefaultApplication('MyApp');
machine.setDefaultTask('AsGlobalPV');   // the global-variable task

machine.initCyclicRead('Temperature');             // → MyApp::AsGlobalPV:Temperature
machine.initCyclicRead('MotorTask:Speed');         // → MyApp::MotorTask:Speed
machine.initCyclicRead('::Pressure');              // global var, current app
machine.initCyclicRead('Motor.Status.Running');    // struct field
machine.initCyclicRead('Temps[0]');                // array element
```

## Reading variables

Three ways, listed by preference.

### 1. Subscription + callback (recommended)

`initCyclicRead` subscribes the variable on the server and invokes your callback on each change. This is the only path that gets push updates:

```typescript
machine.initCyclicRead('MotorSpeed', (value) => {
  updateGauge(value);
});
```

You can also register additional callbacks later for the same variable:

```typescript
machine.onChange('MotorSpeed', (value) => {
  log('speed changed:', value);
});
```

### 2. Direct property read

Once a variable has been registered (via `initCyclicRead`), you can read its last-known value as a property:

```typescript
machine.initCyclicRead('MotorSpeed');
// ...later, after at least one notification has arrived:
console.log(machine.MotorSpeed);  // last cached value
```

This is a cache read — it does not hit the server. If the variable hasn't received an update yet (or isn't subscribed), the result is `undefined`. Nested structures are reachable the same way:

```typescript
machine.ProductionData.CurrentBatch.Weight;
```

### 3. One-shot async read

For values you don't need continuously:

```typescript
const temp = await machine.readVariable('Temperature');
```

Each call is a server round-trip.

## Writing variables

Always use `writeVariable`:

```typescript
await machine.writeVariable('SetPoint', 25.5);
await machine.writeVariable('Motor.Speed', 1200);
await machine.writeVariable('Temps[0]', 23.5);
```

## Read groups

A read group is one server-side OPC UA subscription that batches many variables at a shared publishing rate. The default group polls at 100 ms. Define more groups when you want different rates:

```typescript
machine.configureReadGroup('fast', {
  publishingInterval: 50,
  samplingInterval: 50,
  enabled: true,
});

machine.configureReadGroup('slow', {
  publishingInterval: 1000,
  samplingInterval: 1000,
  enabled: true,
});

machine.initCyclicRead('MotorSpeed', onSpeed, { readGroup: 'fast' });
machine.initCyclicRead('DailyTotal', onTotal, { readGroup: 'slow' });

// Enable/disable a whole group at runtime:
machine.setReadGroupEnable('slow', false);
```

> **One group per variable.** Calling `initCyclicRead` for the same variable name in two different groups currently creates two server-side monitored items. Pick a group per variable.

LuxConnect also consolidates the hierarchy within a group: if you subscribe to `Motor`, you don't need to also subscribe to `Motor.Speed` — the parent covers its children, and notifications still fire on the child path.

## One-off subscriptions

`subscribe(varName, callback, samplingInterval?)` is a convenience for ad-hoc subscriptions. Variables with the same sampling interval share a group automatically. Returns a handle you pass to `unsubscribe`:

```typescript
const handle = await machine.subscribe('Alarm.Active', (active) => {
  if (active) showBanner();
}, 250);

// later
await machine.unsubscribe(handle);
```

Use this when you don't want to manage read group names yourself.

## Connection events

```typescript
import { ConnectionState } from '@loupeteam/lux-connect';

machine.onConnectionStateChanged((state) => {
  // 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'reconnecting' | 'error'
  console.log('state:', state);
});

machine.onError((err) => {
  console.error(err.message);
  if (err.isConnectionError()) { /* ... */ }
  if (err.isRetryable())       { /* ... */ }
});
```

Reconnection is automatic: when the keep-alive fails or the WebSocket drops, LuxConnect re-creates the session and rebuilds every active subscription.

## Error policies

`OpcuaMachine` has three modes for how `readVariable` / `writeVariable` behave on failure.

```typescript
machine.setErrorPolicy('default');  // log warning, resolve with cached value
machine.setErrorPolicy('strict');   // reject the promise; you must catch
machine.setErrorPolicy('silent');   // resolve with cached value, no log
```

| Policy | Throws | `.catch()` fires | Logs | Returns cached fallback | Use for |
|---|---|---|---|---|---|
| `default` | no | no | yes | yes | UI / dashboards |
| `strict` | yes | yes | no | no | tests, safety-critical writes |
| `silent` | no | no | no | yes | background polling |

In `default` and `silent` mode promises **always resolve** — `.catch()` will never run. Check the value:

```typescript
const value = await machine.readVariable('Sensor');
if (value === undefined) {
  showError('Sensor offline');
} else {
  display(value);
}
```

## User management

Change credentials without dropping the connection:

```typescript
await machine.changeUser('operator', 'op-password');
await machine.changeUser();  // back to anonymous

machine.getCurrentUser();       // string | undefined
machine.getCurrentUserRoles();  // string[] | undefined
machine.getSessionInfo();       // { sessionId, endpointUrl, username, roles, ... }

const unsub = machine.onUserChanged((username) => {
  console.log('now logged in as:', username);
});
```

Active subscriptions stay open but may glitch briefly during the user swap.

## Session persistence (browser)

In a SPA, page navigations would normally tear down the OPC UA session. The default `LocalStorageSessionStore` persists session metadata so `connect()` reuses an existing session when the user navigates between pages.

```typescript
import { OpcuaMachine, InMemorySessionStore } from '@loupeteam/lux-connect';

// Opt out of persistence:
const machine = new OpcuaMachine({ host: 'plc', sessionStore: false });

// Or use the in-memory store explicitly (default in Node):
const machine = new OpcuaMachine({ host: 'plc', sessionStore: new InMemorySessionStore() });
```

## Browser usage

```html
<!DOCTYPE html>
<script type="module">
  import { OpcuaMachine } from './node_modules/@loupeteam/lux-connect/dist/index.js';

  const machine = new OpcuaMachine({
    host: window.location.hostname,
    port: 8443,
    protocol: 'https',
  });

  await machine.connect();
  machine.initCyclicRead('Temperature', (t) => {
    document.getElementById('temp').textContent = `${t} °C`;
  });
</script>
<p>Temperature: <span id="temp">--</span></p>
```

## API reference

### `OpcuaMachine`

**Connection**
- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `recoverSubscriptions(): Promise<void>` — manual resubscribe; usually not needed
- `isConnected: boolean`
- `connectionState: ConnectionState`
- `onConnectionStateChanged(handler)`
- `onError(handler)`

**Variables — subscription path**
- `initCyclicRead(name, callback?, options?)`
- `initCyclicReadGroup(group, name, callback?, options?)`
- `onChange(name, callback)`
- `subscribe(name, callback, samplingInterval?) → handle`
- `unsubscribe(handle)`
- `configureReadGroup(name, options)`
- `setReadGroupEnable(name, enabled)`

**Variables — one-shot**
- `readVariable(name): Promise<value>`
- `writeVariable(name, value): Promise<void>`

**Variables — defaults & namespaces**
- `setDefaultApplication(app)`
- `setDefaultTask(task)`
- `setErrorPolicy('default' | 'strict' | 'silent')`

**Inspection**
- `value(name)` — cached value (same as property read)
- `getFromGlobalState(path)`
- `getAppModules()` / `getScopes(app?)` / `getVariablesInScope(app?, scope?)`
- `getGlobalState()` — full cached tree

**User / session**
- `changeUser(username?, password?)`
- `getCurrentUser()` / `getCurrentUserRoles()`
- `getSessionInfo()`
- `onUserChanged(handler) → unsubscribe`

### `LuxConnectError`

Thrown in `strict` mode. Has:
- `code: LuxConnectErrorCode`
- `isConnectionError(): boolean`
- `isRetryable(): boolean`

Common codes: `NOT_CONNECTED`, `AUTHENTICATION_FAILED`, `NETWORK_ERROR`, `OPERATION_FAILED`, `INVALID_VARIABLE`, `PERMISSION_DENIED`.

## Troubleshooting

**Variable never updates**
- Did you call `initCyclicRead` for it?
- Is the read group enabled? (`machine.setReadGroupEnable('default', true)`)
- Is the connection up? (`machine.connectionState === 'connected'`)
- Is the name correct? Wrong app/task scoping is the most common cause — try the full form (`MyApp::MyTask:Var`) to confirm.

**`connect()` throws or hangs**
- Server URL, port, and protocol match the mapp Connect config?
- TLS cert trusted by your client (self-signed certs need to be accepted)?
- Credentials valid? Anonymous access enabled on the server if you omitted them?

**Browser cert warnings against the example server**
- The example `AsProject` ships a publicly-known self-signed cert so `https://` works out of the box. Regenerate it before exposing any real hardware.

## Development

```bash
npm install
npm run build      # tsc
npm test           # vitest
npm run demo       # local demo server (scripts/serve-demo.js)
```

## License

MIT
