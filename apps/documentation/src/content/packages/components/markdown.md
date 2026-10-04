---
title: Markdown
summary: Draw Markdown as native text and views, with links and images held to safe schemes.
---

# Markdown

`<markdown>` draws a Markdown document as native views: headings, paragraphs, emphasis, inline
code, links, quotes, ordered, unordered and task lists, code blocks, rules, tables and images. It
works in any app on these packages, with or without a router. It parses with
[marked](https://marked.js.org), an optional peer dependency, so install it beside the package:

```sh
npx expo install marked
```

Then import the component from its own entry point and give it the document:

```ts
import { Component } from '@angular/core';
import { Markdown } from '@ng-native/components/markdown';

@Component({
  selector: 'app-release-notes',
  imports: [Markdown],
  template: `<markdown [source]="notes" />`,
})
export class ReleaseNotes {
  protected readonly notes =
    '# Version 2\n\nNow with **offline** support. [Read more](https://example.com/v2)';
}
```

The main `@ng-native/components` entry point never imports `marked`, so an app that renders no
Markdown is not asked to install it.

## What it draws

Each block is its own element, and each paragraph is one `<text>` with a nested `<text>` for every
emphasis, code span and link inside it, so the paragraph wraps as a single run of text.

| Markdown                 | Drawn as                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `#` to `######`          | `<text>` announced as a header                                    |
| A paragraph              | `<text>`                                                          |
| `**`, `*`, `~~`, `` ` `` | a nested `<text>`                                                 |
| A link                   | a nested `<text>` you can press, announced as a link              |
| `>`                      | `<view>` with a rule down its side                                |
| A list                   | a `<view>` row per item, its number, bullet or checkbox beside it |
| A fenced code block      | selectable monospace `<text>` in a horizontal `<scroll-view>`     |
| `---`                    | a one-point `<view>`                                              |
| A table                  | a `<view>` row per table row                                      |
| An image                 | `<image>` lifted out of its paragraph, labelled by its alt text   |

An ordered list starts at the number its first item has. An image is drawn at the full width
with a 200-point height until it loads, then at its own shape.

## Nothing is interpreted

The document can come from anywhere, a server or a person, so nothing in it runs:

- **Raw HTML** is drawn as the text it is written as. `<b>bold</b>` shows its tags.
- **Links** are followed only to `http`, `https`, `mailto`, `tel` and relative targets. Any other
  scheme, such as `javascript:`, `data:`, `vbscript:` or `file:`, is drawn as the link's text, with
  nothing to press. The scheme is read the way a URL parser reads it, so spaces, tabs and control
  characters in it change nothing.
- **Images** load only over `http` and `https`. Anything else is drawn as its alt text.

HTML entities marked leaves in the text, such as `&amp;`, `&quot;` and `&#39;`, are decoded once.
A code span or block keeps them as written.

## Links

Pressing a link emits `(linkPress)` with the `href` and `title`. An absolute target is then handed
to the device with `DeepLinks.open` from `@ng-native/device`, which opens a browser, the mail app
or the phone. Call `preventDefault()` to handle the link yourself. A relative target is only
reported, since only the app knows what it means:

```ts
import { Component, inject } from '@angular/core';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeNavigation } from '@ng-native/router';

@Component({
  selector: 'app-help',
  imports: [Markdown],
  template: `<markdown [source]="help" (linkPress)="follow($event)" />`,
})
export class Help {
  private readonly navigation = inject(NativeNavigation);
  protected readonly help = 'See [your settings](/settings) or [the website](https://example.com).';

  protected follow(link: MarkdownLinkPress): void {
    if (!link.href.startsWith('/')) return;
    link.preventDefault();
    void this.navigation.push(link.href);
  }
}
```

In the browser host nothing is opened by default, so handle `(linkPress)` there.

## Styling

Every element carries a default class: `md-h1` to `md-h6`, `md-p`, `md-strong`, `md-em`,
`md-del`, `md-code`, `md-a`, `md-blockquote`, `md-ul`, `md-ol`, `md-li`, `md-marker`, `md-pre`,
`md-hr`, `md-img`, `md-table`, `md-tr`, `md-th` and `md-td`. They follow the system's light and
dark appearance. Text takes its color and size from the `<markdown>` element, as it would on the
web, so a class on the element itself restyles the whole document.

`classes` replaces one element's default class with your own, by the element's name. The class
has to come from a stylesheet that reaches inside the component: a global one, or Tailwind.

```html
<markdown [source]="notes" [classes]="{ h1: 'text-3xl font-bold', a: 'md-a text-blue-600' }" />
```

Keep the default beside your own, as `a` does above, to change only part of it.

The default classes need nothing in your Metro config, in a workspace or installed from npm: the
[transformer](/packages/metro/configuration) compiles every `@ng-native/*` package's component CSS
into native sheets, with no `libraryStyles` entry.

## Tokens lexed already

`tokens` takes the tokens `marked.lexer` returns, in place of `source`, so a document can be lexed
once, ahead of time or on a server, and drawn without parsing again on the device. When both are
set, `tokens` wins.

```ts
import { lexer } from 'marked';

const tokens = lexer('# Lexed once');
```

```html
<markdown [tokens]="tokens" />
```

## Importing .md files

A `.md` file in the app is a module, in any app bundled with `withAngularNative`, with or without
Analog. Metro reads its front matter and lexes its Markdown with `marked` as it bundles, so the
device receives tokens and parses nothing:

```md
---
title: Version 2
version: 2.0.0
---

Now with **offline** support.
```

```ts
import { Component } from '@angular/core';
import { Markdown } from '@ng-native/components/markdown';
import notes from './release-notes.md';

@Component({
  selector: 'app-release-notes',
  imports: [Markdown],
  template: `<markdown [tokens]="notes.tokens" />`,
})
export class ReleaseNotes {
  protected readonly notes = notes;
}
```

The import is `{ attributes, content, tokens }`:

| Field        | What it holds                                                 |
| ------------ | ------------------------------------------------------------- |
| `attributes` | The front matter, parsed as YAML; `{}` when the file has none |
| `content`    | The Markdown after the front matter                           |
| `tokens`     | `content` lexed by `marked.lexer`, for `<markdown [tokens]>`  |

`marked` has to be installed for the build, as above. The front matter is read with
[front-matter](https://www.npmjs.com/package/front-matter), the parser `@analogjs/content` uses, and
must be a mapping of names to values. A date in it arrives as its ISO string,
`2026-10-04T00:00:00.000Z`, because the module is plain JSON. Front matter that is not valid YAML
fails the build with the file's name in the message. Windows line endings and an empty file are
read as you would expect.

For TypeScript, add the module's type to the app's `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@ng-native/metro/markdown"]
  }
}
```

`attributes` is typed as unknown values. Name its fields with `MarkdownFile`:

```ts
import type { MarkdownFile } from '@ng-native/metro/markdown-file';
import release from './release-notes.md';

const notes = release as MarkdownFile<{ title: string; version: string }>;
```

An edit to a `.md` file rebuilds it like any other module, and a new version of `marked` rebuilds
every one. In tests, the `ngNative()` Vitest plugin and the `@ng-native/testing/register` hook
import a `.md` file the same way, so a test sees what the bundle has. Add `?raw` to an import under
Vitest to get the file's text instead.

## An example app

`examples/markdown` in the repository is a reader built on this page, without Analog: notes that
are `.md` files imported through Metro and drawn from their tokens, a live editor that parses what
is typed through `source`, relative links pushed on a native stack with `(linkPress)`, light and
dark appearance, and a note whose elements take the app's own classes through `classes`.

## With Analog

An Analog page is a component like any other, so `<markdown>` goes in a page's template
unchanged. The Analog example's `markdown.page.ts` shows a document whose relative links are routed
with `NativeNavigation`, as in [Links](#links).

`@ng-native/analog` reads `src/content` as `@analogjs/content` does, with `injectContent` and
`injectContentFiles`, and routes a `.md` file in `src/app/pages` as a page. Both hand you the
tokens Metro lexed: see [Content files](/packages/analog#content-files).
