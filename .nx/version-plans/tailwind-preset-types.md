---
__default__: patch
---

`@ng-native/tailwind/preset.cjs` ships type declarations, so a `tailwind.config.ts` in a strict
TypeScript project can import the Tailwind 3 preset. The import used to fail with TS7016, an
implicit `any`.
