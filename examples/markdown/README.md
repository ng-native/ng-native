# Markdown Reader

A small reader for Markdown files, built with Angular Native and drawn as native views by
`<markdown>` from `@ng-native/components/markdown`. No Analog: the notes are `.md` files the app
imports, and the screens are plain routes on `@ng-native/router`'s native stack.

| Screen              | File                                              | What it shows                                                   |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Library             | `src/app/library/library.ts`                      | Each note by the title and summary in its front matter          |
| Note                | `src/app/note/note-screen.ts`                     | A note drawn from the tokens Metro lexed, `<markdown [tokens]>` |
| Live editor         | `src/app/editor/editor.ts`                        | Markdown typed on the device, parsed as it changes, `[source]`  |
| Styled with classes | `src/app/styled/styled-note.ts`, `serif-theme.ts` | `classes` swapping the default `md-*` classes for the app's own |

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

A link opens a screen directly: `markdownreader:///notes/formatting`, `markdownreader:///editor` or
`markdownreader:///styled`.

`src/app/app.test.ts` checks the library's titles from the front matter, a note drawn from its
tokens with a relative link routed and an absolute one opened outside the app, the editor parsing
what is typed, and the styled note's headings and link taking the app's classes.
