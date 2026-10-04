---
__default__: minor
---

A `.md` file is a module in any app bundled with `withAngularNative`: `import post from './post.md'` is `{ attributes, content, tokens }`, its front matter parsed with `front-matter` and its Markdown lexed by `marked` as the app is bundled, so `<markdown [tokens]="post.tokens">` parses nothing on the device. `marked` is a new optional peer dependency of `@ng-native/metro`, needed only when the app has a `.md` file; a new version of it rebuilds every cached one. `"types": ["@ng-native/metro/markdown"]` types the import, and `MarkdownFile` from `@ng-native/metro/markdown-file` names its attributes. The `ngNative()` Vitest plugin and the `@ng-native/testing/register` hook import a `.md` file the same way, and the plugin leaves one to a Vite plugin ahead of it that already made the file a module.
