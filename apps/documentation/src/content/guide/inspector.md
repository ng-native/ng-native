---
title: Inspecting an app
summary: See an app's components, signals, injectors and stores on a device, in Pangular Inspector.
---

# Inspecting an app

[Pangular Inspector](https://pangular-inspector.dev/) shows an app on a device as it runs: an
overlay in the app walks Angular Native's node tree and reports to a server on your machine over a
WebSocket, and the panel shows what it sends.

| Tab        | What it shows                                                                         |
| ---------- | ------------------------------------------------------------------------------------- |
| Components | The component tree and the selected component's inputs, signals and injected services |
| Signals    | The signal graph of the selected component, with live values                          |
| Injectors  | Element and environment injectors, with their providers                               |
| Store      | Live `@ngrx/signals` and `@ngrx/store` state and the change log                       |
| Pipes      | The pipes in use, their instances and the components that use them                    |

Pointing at a component in the panel outlines its view on the device. The router, forms, HTTP and
change detection tabs have no live data for an app on a device.

## Set it up

It runs in a development build, where Angular publishes its debug API. Install it beside the app:

```sh
npm install --save-dev @pangular-inspector/devtools devframe
```

Start the overlay after `mount()` in `src/main.ts`, with the root node it returns. The `__DEV__`
check keeps it out of a release build:

```ts
import { initAngularNativeOverlay } from '@pangular-inspector/devtools/overlay-angular-native';

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const app = mount(Number(rootTag), App, getFabricUIManager(), {
    // ...the options the app already passes
  });
  if (__DEV__) initAngularNativeOverlay({ root: app.engine.root });
});
```

Start the server from the app's folder, and open the **Angular Native apps** address it prints,
`http://localhost:9999/?view=angular-native`:

```sh
npx @pangular-inspector/devtools dev --no-auth
```

`--no-auth` is needed because the app cannot answer the one-time code the server otherwise asks
for. It lets anything that reaches the server use it, so keep the server on `localhost` or a
trusted network.

## Reach the server from a device

| Where the app runs                     | What to do                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| iOS simulator                          | Nothing: it shares the machine's `localhost`.                                                        |
| Android emulator or USB Android device | `adb reverse tcp:9999 tcp:9999`, as Metro does for its own port.                                     |
| A phone over Wi-Fi                     | Start the server with `--host` set to the machine's LAN address, and pass that address as `baseURL`. |

An Expo app has the standard `URL` the overlay needs. A bare React Native app needs a polyfill,
such as `react-native-url-polyfill`, since React Native's own `URL` is read-only.

## For a coding agent

The server also speaks MCP, at `http://localhost:9999/__mcp`, so an agent can read the same tree,
signals and injectors from a running app. See [AI](/guide/ai-assistants).

The inspector's own
[Angular Native page](https://pangular-inspector.dev/getting-started/angular-native) covers its
options, how it works and what to check when a tab stays empty.
