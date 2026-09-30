# @ng-native/tailwind

A Tailwind CSS preset for Angular Native, for Tailwind 4 on native and web and Tailwind 3 on
native: `<view class="flex-1 bg-blue-500 p-4">` works because
[`@ng-native/fabric`](https://github.com/ng-native/ng-native/blob/main/packages/fabric) already has
a real cascade, and `class` already matches against it.

Alpha: APIs may change before 1.0.

## Install (Tailwind 4)

```sh
npm install @ng-native/tailwind @ng-native/metro @tailwindcss/cli tailwindcss
```

## Example (Tailwind 4)

```css
/* styles.css */
@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
@import '@ng-native/tailwind/native.css';
```

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withTailwind } = require('@ng-native/tailwind/config.cjs');

module.exports = withTailwind(withAngularNative(getDefaultConfig(__dirname)), {
  input: './styles.css',
});
```

```ts
// index.ts
import tailwind from './.angular-native/app.tailwind.js';
import { mount } from '@ng-native/platform';

mount(rootTag, App, fabric, { globalStyles: tailwind });
```

Import `theme.css` and `utilities.css`, not the plain `tailwindcss` entry point - that also pulls
in preflight, a browser reset that means nothing on a phone.

## Tailwind 3 (native only)

```sh
npm install @ng-native/tailwind @ng-native/metro tailwindcss@3
```

```js
// tailwind.config.js
module.exports = {
  presets: [require('@ng-native/tailwind/preset.cjs')],
  content: ['./src/**/*.{ts,html}'],
};
```

```css
/* styles.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`metro.config.js` and `index.ts` are the same as above: `withTailwind` sees Tailwind 3 and runs its
own CLI, so there is no `@tailwindcss/cli` to install. The preset turns preflight off.

Tailwind 3 adds its default configuration beneath every preset with no `presets` key, and a later
preset's defaults override an earlier preset's theme. Beside a preset of the app's own, list this
one after it with `presets: []`, so only the first preset brings the defaults:

```js
presets: [
  require('./design-system.preset.js'),
  { ...require('@ng-native/tailwind/preset.cjs'), presets: [] },
],
```

## What's in the package

- `./native.css` - the preset: platform variants, safe-area and hairline utilities, and
  touch-appropriate `hover:`/`focus-visible:` meanings.
- `./web.css` - the same preset's web entry point, for `@ng-native/web`.
- `./preset.cjs` - the native preset for Tailwind 3, used from `tailwind.config.js`.
- `./config.cjs` - `withTailwind`, the Metro config step that runs the app's Tailwind CLI and
  flattens its output for the CSS compiler.

## Docs

- [Tailwind](https://ng-native.com/packages/tailwind), including
  [Tailwind 3](https://ng-native.com/packages/tailwind#tailwind-3)
- [Variants](https://ng-native.com/packages/tailwind/variants) and
  [safe area and hairlines](https://ng-native.com/packages/tailwind/utilities)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/ARCHITECTURE.md)

## License

MIT
