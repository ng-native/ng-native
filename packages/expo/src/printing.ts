/**
 * `Printing`, bound to `expo-print`: the system's print dialog, and HTML rendered to a PDF file.
 *
 * ```ts
 * private readonly printing = inject(Printing);
 * await this.printing.print({ html: '<h1>Invoice</h1>' });
 * await this.printing.print({ window: inject(CURRENT_WINDOW) }); // macOS: what the window shows
 * const pdf = await this.printing.printToPdf(invoiceHtml);
 * ```
 *
 * The module is reached through a slice of its own functions written here, so this entry point
 * needs no types from the package. Without the module installed every call is inert: `print()`
 * does nothing, and `printToPdf()` and `selectPrinter()` answer null.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { OS } from '@ng-native/device';
import { currentPlatform, expoModule, presence } from './native.ts';

/** A printer, as iOS's picker answers it. */
export interface Printer {
  readonly name: string;
  readonly url: string;
}

/** The slice of `expo-print` this calls. The real module is one; a test provides a fake. */
export interface NativePrinting {
  printAsync(options: {
    html?: string;
    uri?: string;
    /** macOS: the surface of the window whose content prints. */
    window?: number;
    printerUrl?: string;
    orientation?: 'portrait' | 'landscape';
  }): Promise<void>;
  printToFileAsync(options: {
    html: string;
    width?: number;
    height?: number;
  }): Promise<{ uri: string; numberOfPages: number }>;
  /** iOS only: the system's printer picker. */
  selectPrinterAsync?(): Promise<Printer>;
}

/** A window, as `AppWindows` and `CURRENT_WINDOW` answer it: only its surface is read. */
export interface PrintableWindow {
  readonly surface: number;
}

/**
 * What `print()` prints: HTML, a file such as a PDF, or on macOS what a window shows; and on iOS
 * the printer to use.
 */
export type PrintOptions = (
  | { readonly html: string; readonly uri?: never; readonly window?: never }
  | { readonly uri: string; readonly html?: never; readonly window?: never }
  | {
      /**
       * macOS: what this window shows, laid out on the paper the print panel has. Web views print
       * their page; video, the camera preview and Metal content print blank. Absent on every other
       * OS, where the call does nothing.
       */
      readonly window: PrintableWindow;
      readonly html?: never;
      readonly uri?: never;
    }
) & {
  /** iOS: print to this printer, from `selectPrinter()`, without showing the dialog. */
  readonly printer?: Printer;
  readonly orientation?: 'portrait' | 'landscape';
};

@Service()
export class Printing {
  /** Overridden in a test to print without a printer. */
  static readonly SOURCE = new InjectionToken<NativePrinting | null>(
    'angular-native.printingSource',
    { factory: () => expoModule('expo-print', () => require('expo-print') as NativePrinting) },
  );

  private readonly native = inject(Printing.SOURCE);
  private readonly os = inject(OS, { optional: true }) ?? currentPlatform();

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /**
   * Shows the print dialog for HTML, a file, or on macOS a window's content. Resolves once it
   * closes, printed or not. A window prints nothing off macOS.
   */
  async print(options: PrintOptions): Promise<void> {
    if (!this.native) return;
    const { printer, window, ...rest } = options;
    if (window) {
      if (this.os !== 'macos') return;
      await this.native.printAsync({ ...rest, window: window.surface });
      return;
    }
    await this.native.printAsync(printer ? { ...rest, printerUrl: printer.url } : rest);
  }

  /**
   * Renders HTML to a PDF file in the cache and answers its uri, to share or save. `width` and
   * `height` are the page size in points, US Letter by default. Null without the module.
   */
  async printToPdf(
    html: string,
    page: { width?: number; height?: number } = {},
  ): Promise<string | null> {
    if (!this.native) return null;
    return (await this.native.printToFileAsync({ html, ...page })).uri;
  }

  /**
   * iOS's printer picker: answers the printer chosen, or null when it is dismissed and on an OS
   * with no picker. Any other failure is rethrown.
   */
  async selectPrinter(): Promise<Printer | null> {
    const pick = this.native?.selectPrinterAsync;
    if (!pick) return null;
    try {
      return await pick.call(this.native);
    } catch (error) {
      // Dismissed, or Android, where expo-print has the function and no picker behind it.
      const code = String((error as { code?: unknown } | null)?.code ?? '');
      if (/cancel/i.test(code) || code === 'ERR_UNAVAILABLE') return null;
      throw error;
    }
  }
}
