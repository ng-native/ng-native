---
__default__: patch
---

Add `@ng-native/turbo`, generators for a Turborepo workspace: `npx @ng-native/turbo init`, then `turbo gen ng-native-app`, `ng-native-library` and `ng-native-component`, and `ng-native-turbo sync` to list in each app the native modules its libraries use, with their config plugins.

`init` registers the generators in a new `turbo/generators/config.ts`, or says what to add to the generator config a workspace has, in TypeScript or JavaScript. It adds the `build`, `typecheck`, `test`, `lint` and `dev` tasks a `turbo.json` or `turbo.jsonc` lacks, leaving one with comments for those to be added by hand, and in a pnpm workspace it declines `esbuild`'s install script in `pnpm-workspace.yaml`'s `allowBuilds`, without which pnpm 11 stops the install. A package the generators write is named under the root `package.json`'s scope, or, where the root has none, under the one scope the workspace's packages share, as `@repo` in a workspace `create-turbo` made. An app is the template's, as a workspace package with `dev` and `build` scripts, a Metro port of its own and a `turbo.json` that caches its `expo export`, hashes its `.env` files, and reruns its `build`, `typecheck` and `test` when a library it uses changes. A library, in `packages/native-ui` unless another directory is given, exports its source, with Angular and `@ng-native/components` as peers and tests that run in Node. See https://ng-native.com/packages/turbo.

The workspace globs that `@ng-native/nx`'s app generator reads from `pnpm-workspace.yaml` are now read past comment lines and with CRLF line endings, keep a quoted entry's `#` and commas, and match with or without a leading `./`.
