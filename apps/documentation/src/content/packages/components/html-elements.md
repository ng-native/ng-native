---
title: HTML elements
summary: span, p, h1 and div in a template, what each draws as, and how they differ from a browser.
art: text
---

# HTML elements

A template can use HTML's text and layout elements as it would for a browser. They need no import
and no registration.

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-article',
  template: `
    <section class="article">
      <h1>Cascade layers</h1>
      <p>A rule in a layer loses to <strong>every</strong> rule outside one.</p>
    </section>
  `,
})
export class Article {}
```

## Text elements

`span`, `p`, `h1` to `h6`, `label`, `strong`, `b`, `em`, `i`, `u`, `s`, `small`, `code`, `mark`,
`abbr`, `cite` and `time` are text. What each draws as depends on what it holds:

- **Only text, and other text elements:** it is text, as [`<text>`](/packages/components/text) is,
  and the text elements inside it flow inline. `<p>Hello <strong>world</strong></p>` is one
  paragraph.
- **Anything else:** it is a view, and each run of text written in it is a paragraph of its own. A
  box inside a paragraph has no layout, so `<span>Inbox<view class="dot" /></span>` is a view that
  holds a paragraph and a view.

The answer follows the element's content: a `span` that gains a view becomes a view, and is text
again when the view goes.

Use [`<text>`](/packages/components/text) for what these do not have: `numberOfLines`,
`selectable`, `(press)` and the rest of its inputs.

## Layout elements

`div`, `section`, `article`, `header`, `footer`, `main`, `nav`, `ul`, `ol` and `li` are views, the
same as `<view>` with none of its inputs: a flex column, as every view is. A list has no markers.

## Text written straight into a view

A run of text directly inside a view, or inside any element that is not text, is drawn as a
paragraph of its own, with the text styles the view hands down. Whitespace between elements draws
nothing.

```html
<view class="card">Card body</view>
```

Every view is a flex column, on a device and on the web host alike, so each run of text and each
element inside one is its own item. `<div>Hello <span>world</span>!</div>` is three items, one above
the next. Text flows inline only inside a text element: write `<p>Hello <span>world</span>!</p>`.

## What they look like

They have the few styles of their own that Tailwind's preflight leaves a browser's elements, and
none of the rest:

| Element             | Style                                           |
| ------------------- | ----------------------------------------------- |
| `strong`, `b`       | Bold                                            |
| `em`, `i`, `cite`   | Italic                                          |
| `u`                 | Underlined                                      |
| `s`                 | Struck through                                  |
| `small`             | Four fifths of the size around it               |
| `code`              | The platform's monospace font                   |
| `mark`              | Black on yellow                                 |
| Every other element | Nothing: a heading is not large, bold or spaced |

Any rule in a stylesheet beats these, whatever its specificity, as it beats a browser's own.
`@ng-native/web` resets the same elements to match, so a page looks the same in both.

`h1` to `h6` are announced as headings by a screen reader.

## What is not here

- `button`, `a`, `input`, `img`, `form`, `table` and every other HTML element are not known, and
  are reported in development. Use [`<pressable>`](/packages/components/pressable),
  [`<text-input>`](/packages/components/input) and [`<image>`](/packages/components/image).
- There is no DOM behind them: no `document`, and no element API on a node.
- `label` is text. It is not tied to an input.
- An element name an app registers with `registerViewName` is the app's, and is no longer decided
  by what the element holds.
