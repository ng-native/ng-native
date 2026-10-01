---
__default__: patch
---

`@ng-native/tailwind` has a Tailwind 3 preset for the web, `web-preset.cjs`, so a Tailwind 3 app styles its components in a browser through `@ng-native/web` as on a device, with or without a `prefix`.

It is the Tailwind 3 counterpart of `web.css`: `hover:` and `focus-visible:` are the browser's own, the safe area comes from `env()`, a hairline is one device pixel on a high-density screen, and `font-mono` keeps Tailwind's stack. Its `dark:` and platform variants match the `dark` and `platform-web` classes `mount` keeps on the root as attributes (`[class~="dark"]`), so a Tailwind 3 `prefix` no longer stops them matching. `preset.cjs` is unchanged and builds the same CSS as before. The web docs describe the setup: a `tailwind.web.config.js` that swaps in the web preset, and a PostCSS config for Vite.
