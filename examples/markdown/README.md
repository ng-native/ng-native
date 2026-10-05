# Native Pages

A small reader for Markdown files, showing file routes and native Markdown, built with Angular Native and drawn as native views by
`<markdown>` from `@ng-native/components/markdown`. No Analog: the notes are `.md` files the app
imports, and the screens are files in `src/app/pages`, routed by `fileRoutes` from
`@ng-native/router` on its native stack.

| Screen              | File                                                            | What it shows                                                   |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Library             | `src/app/pages/index.page.ts`                                   | Each note by the title and summary in its front matter          |
| Note                | `src/app/pages/notes/[slug].page.ts`                            | A note drawn from the tokens Metro lexed, `<markdown [tokens]>` |
| Live editor         | `src/app/pages/editor.page.ts`                                  | Markdown typed on the device, parsed as it changes, `[source]`  |
| Styled with classes | `src/app/pages/styled.page.ts`, `src/app/styled/serif-theme.ts` | `classes` swapping the default `md-*` classes for the app's own |
| A Markdown page     | `src/app/pages/about.md`                                        | A `.md` file that is a screen of its own, by its file name      |

`src/app/pages.ts` finds the pages with `require.context`, and `src/app/app.config.ts` gives them
to `fileRoutes`, with `MarkdownPage` (`src/app/ui/markdown-page.ts`) as the component that draws a
`.md` page: it reads the file with `injectMarkdownPage()`, and the front matter `title` is the
route's title. A note's `[slug]` arrives as its `slug` input. See
[File routes](https://ng-native.com/packages/router/file-routes).

`import welcome from './welcome.md'` works because `withAngularNative` in `metro.config.js` makes a
`.md` file a module: its front matter parsed and its Markdown lexed by `marked` as the app is
bundled, as `{ attributes, content, tokens }`. `"types": ["@ng-native/metro/markdown"]` in
`tsconfig.json` types the import, and `src/app/note/notes.ts` names the front matter with
`MarkdownFile<NoteAttributes>`.

A relative link in a note, such as `/notes/formatting`, is pushed on the stack by the
`(linkPress)` handler in `src/app/ui/follow-link.ts`; an absolute one is left to `<markdown>`, which
opens it outside the app. Everything follows the system's light and dark appearance.

## Run it

From the repository root, after `pnpm install`:

```sh
cd examples/markdown
pnpm start     # press i or a, or scan the QR code with Expo Go
pnpm test      # Vitest in Node, no simulator
```

A link opens a screen directly: `markdownreader:///notes/formatting`, `markdownreader:///editor`,
`markdownreader:///styled` or `markdownreader:///about`.

`src/app/app.test.ts` checks the library's titles from the front matter, a note drawn from its
tokens with a relative link routed and an absolute one opened outside the app, the editor parsing
what is typed, the styled note's headings and link taking the app's classes, and `about.md` routed
as a screen, titled by its front matter. The tests find the pages with `import.meta.glob`, since
Vitest has no `require.context`.
