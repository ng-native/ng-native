---
title: Printing
summary: Print HTML or a file with the system's print dialog, and render HTML to a PDF.
---

# Printing

`Printing` is the system's print dialog and an HTML-to-PDF renderer, bound to `expo-print`.

<!-- platforms: Printing -->

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

On Linux the GTK host prints a window or an image through GTK's print dialog, which is the
desktop's Print portal inside a Flatpak, and a PDF through the Print portal, which takes the file as
it is; with no portal, GTK's own dialog sends the PDF to a printer that takes PDF. HTML has no
engine to lay it out on Linux, so `print({ html })` and `printToPdf()` reject there.

## Printing a window on macOS and Linux

`print({ window })` prints what a window shows, drawn as it is on screen and scaled down to the
paper, with the print dialog as a sheet on that window. A web view prints its page as WebKit's
snapshot of it. A video, the camera preview and anything drawn with Metal print blank, since they
draw outside the window's own drawing and capturing them would need the Screen Recording
permission. On Linux the window is drawn onto one page, scaled down to fit it. It takes an
`AppWindow`, from `AppWindows.open()` or `CURRENT_WINDOW`:

```ts
import { Component, inject } from '@angular/core';
import { CURRENT_WINDOW } from '@ng-native/device';
import { Printing } from '@ng-native/expo/printing';

@Component({ selector: 'app-report', template: '' })
export class Report {
  private readonly window = inject(CURRENT_WINDOW);
  private readonly printing = inject(Printing);

  protected async printWindow(): Promise<void> {
    if (this.window) await this.printing.print({ window: this.window });
  }
}
```

On iOS, Android and the web a window prints nothing and the call resolves.

The default menu bar has File > Print... (Command-P, and Ctrl+P on Linux), which prints the key
window this way. An app
that prints something else, such as a document, gives its own item the `print` role and a handler
in its `<menu-bar>`; that item takes Print...'s place and Command-P, and the host leaves printing
to it.

## Without the module

On iOS, Android and macOS, a missing `expo-print` throws a
[`MissingModuleError`](/packages/expo/using-a-module#what-happens-without-the-module-installed) on
the first call. Injecting the service does not throw.

On the web, and in a test that provides no fake,
`available()` is `false`, `print()` does nothing, and `printToPdf()` and `selectPrinter()` resolve
to `null`.

## Reference

<!-- api: Printing -->
