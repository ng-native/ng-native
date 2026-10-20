# @ng-native/eslint-plugin

ESLint rules for Angular Native: the DOM events, HTML controls and browser APIs that compile but do
nothing on a device. `(click)` on a `<pressable>`, a `<button>`, `routerLink` and a `document` read
all pass Angular's compiler; each rule reports one and names what to write instead.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install --save-dev eslint typescript-eslint angular-eslint @ng-native/eslint-plugin
```

An app generated with `nx g @ng-native/nx:app --linter=eslint` or
`ng add @ng-native/schematics --linter=eslint` has it set up already.

## Example

```js
// eslint.config.mjs
import ngNative from '@ng-native/eslint-plugin';

export default [
  { ignores: ['.expo/', 'ios/', 'android/', 'dist/'] },
  ...ngNative.configs.recommended,
];
```

```sh
npx eslint .
```

## Docs

- [ESLint](https://ng-native.com/packages/eslint-plugin) for setup in each kind of workspace, each
  rule and what it reports.
