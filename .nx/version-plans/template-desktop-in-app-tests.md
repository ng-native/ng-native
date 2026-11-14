---
__default__: patch
---

The macOS template runs its tests in two Vitest projects: `node-macos`, which `npm test` runs in Node, and `macos`, which `vitest --project macos` runs inside the app on a Mac, from `src/**/*.device.ts`, with Metro started with `EXPO_PUBLIC_DEVICE_TESTS=1`. Its Metro config and `main.ts` carry the set-up.
