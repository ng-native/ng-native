---
__default__: minor
---

`@ng-native/analog` reads Analog's content files and routes its Markdown pages on native. `provideContentFiles(require.context('../content', true, /\.md$/))` feeds `injectContent`, `injectContentFiles`, `contentFilesResource` and `contentFileResource`, named and shaped as `@analogjs/content` has them, with each file's `tokens` for `<markdown>`. A `.md` file in `src/app/pages` is a page, titled by its front matter, drawn by the component given as `pageRoutes(pages, { markdownPage })`, which reads its file with `injectMarkdownPage()`: `@ng-native/router`'s, under the same route data key, so one component draws a `.md` page under `fileRoutes` and `pageRoutes` alike. `rxjs` and `@ng-native/router` are new peer dependencies.
