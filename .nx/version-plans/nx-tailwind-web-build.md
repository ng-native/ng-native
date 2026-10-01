---
__default__: patch
---

`nx g @ng-native/nx:tailwind` now sets up the web build of a project whose Vite config runs `ngNativeWeb()`, with the web preset in place of the native one, whether the browser build sits beside a native app or is an app of its own.

With Tailwind 4 it writes a stylesheet importing `@ng-native/tailwind/web.css` (`src/styles.web.css` beside a native build, `src/styles.css` otherwise), adds `tailwindcss()` from `@tailwindcss/vite` after `ngNativeWeb()`, and adds `@tailwindcss/vite`. With Tailwind 3 it writes a config with `web-preset.cjs` (`tailwind.web.config.js` beside a native build, taking the rest from `tailwind.config.js`) and a `postcss.config.js` that runs Tailwind with it. `index.html` links the stylesheet. Each library named with `--library` is loaded by the web build too. A browser app of its own, which the generator refused before, gets the web build only. Running it again changes nothing.
