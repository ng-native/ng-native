# @ng-native/testing

Runs an Angular Native component test in plain Node, in milliseconds, with no simulator and no
device: Angular Testing Library's `render()` and `screen`, and React Native Testing Library's
`fireEvent` and `userEvent`, over a fake of the native side.

Alpha: APIs may change before 1.0.

## Install

Most apps start from `npx create-expo-app@latest my-app --template @ng-native/template`, which
already has this set up. Otherwise:

```sh
npm install --save-dev @ng-native/testing vitest
```

## Example

```ts
// vitest.config.mts
import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [ngNative()],
});
```

```ts
// app.test.ts
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';

test('counts taps', async () => {
  await render(App);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Tapped 0 times' }));

  expect(screen.getByText('Tapped 1 times')).toBeTruthy();
});
```

The renderer, styling engine, responder system, and every component and primitive under test are
the real ones - only `nativeFabricUIManager` is faked, so a query reads what native would actually
have been sent.

## What's in the package

- `.` - `render()`, `screen`, `fireEvent`, `userEvent`, `cleanup()`, `createFakeFabric()`.
- `./vitest` - `ngNative()`, the Vitest plugin that compiles Angular for tests the way Metro
  compiles it for the app.
- `./register` - a Node module hook for `node --import @ng-native/testing/register --test`, for
  projects that would rather use `node:test` than Vitest.
- `./loader` - the underlying loader `./register` installs.

## Docs

- [Testing](https://ng-native.com/packages/testing)
- [Setup](https://ng-native.com/packages/testing/setup),
  [writing a test](https://ng-native.com/packages/testing/writing-a-test) and the
  [API reference](https://ng-native.com/packages/testing/api)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
