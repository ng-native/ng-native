---
title: Printing
summary: Print HTML or a file with the system's print dialog, and render HTML to a PDF.
---

# Printing

`Printing` is the system's print dialog and an HTML-to-PDF renderer, bound to `expo-print`.

## Install

```sh
npx expo install expo-print
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Printing } from '@ng-native/expo/printing';

@Component({ selector: 'app-invoice', template: '' })
export class Invoice {
  private readonly printing = inject(Printing);

  protected async print(html: string): Promise<void> {
    await this.printing.print({ html });
  }

  protected async exportPdf(html: string): Promise<string | null> {
    return this.printing.printToPdf(html);
  }
}
```

## What it does

- **`print(options)`** - shows the print dialog for `html`, or for the file at `uri`, such as a
  PDF, and resolves once it closes, printed or not. On iOS, `printer` (from `selectPrinter()`)
  prints to that printer without the dialog. `orientation` is `portrait` or `landscape`.
- **`printToPdf(html, page?)`** - renders the HTML to a PDF file in the cache and resolves to its
  uri, to share or [save where the user chooses](/packages/expo/document-picker). `page` takes the
  `width` and `height` in points.
- **`selectPrinter()`** - iOS's printer picker. Resolves to the printer chosen, with its `name`
  and `url`, or `null` when the picker is dismissed and on Android and macOS, which have none.

On macOS the desktop host prints with AppKit: the print dialog opens as a sheet on the key window,
and a `printer` passed to `print()` is ignored. `printToPdf()` breaks pages where the HTML's CSS
asks (`break-before: page`, `break-after: page`).

## Without the module

On iOS, Android and macOS, a missing `expo-print` - never installed, or installed without the app
being rebuilt since - leaves the service made, so injecting it does not throw. A call throws a
`MissingModuleError`; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake,
`available()` is `false`, `print()` does nothing, and `printToPdf()` and `selectPrinter()` resolve
to `null`.

## Reference

<!-- api: Printing -->
