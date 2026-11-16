/**
 * `Printing`, over a fake of `expo-print` that records every call: the print dialog for HTML or a
 * file, HTML to a PDF file, and iOS's printer picker. Without the module every call is inert.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OS } from '@ng-native/device';
import { Printing, type NativePrinting } from '@ng-native/expo/printing';
import { cleanup, injectService } from '@ng-native/testing';
import { serviceWith, servicesWith } from './injected.ts';

function platform(overrides: Partial<NativePrinting> = {}) {
  const calls: unknown[][] = [];
  const native: NativePrinting = {
    printAsync: async (options) => void calls.push(['printAsync', options]),
    printToFileAsync: async (options) => (
      calls.push(['printToFileAsync', options]),
      { uri: 'file:///cache/out.pdf', numberOfPages: 1 }
    ),
    selectPrinterAsync: async () => (
      calls.push(['selectPrinterAsync']),
      { name: 'Office', url: 'ipp://office' }
    ),
    ...overrides,
  };
  return { native, calls };
}

const serviceOn = (native: NativePrinting | null) =>
  serviceWith(Printing.SOURCE, native, () => new Printing());

describe('Printing', () => {
  it('shows the print dialog for HTML, or for a file, with the options given', async () => {
    const { native, calls } = platform();
    const printing = serviceOn(native);
    assert.equal(printing.available(), true);
    await printing.print({ html: '<h1>Invoice</h1>' });
    await printing.print({
      uri: 'file:///cache/out.pdf',
      printer: { name: 'Office', url: 'ipp://office' },
    });
    assert.deepEqual(calls, [
      ['printAsync', { html: '<h1>Invoice</h1>' }],
      ['printAsync', { uri: 'file:///cache/out.pdf', printerUrl: 'ipp://office' }],
    ]);
  });

  it('prints a window on macOS by its surface, and nothing for a window on any other OS', async () => {
    const on = (os: 'macos' | 'ios' | 'android' | 'web') => {
      const fake = platform();
      const printing = servicesWith(
        [
          [Printing.SOURCE, fake.native],
          [OS, os],
        ],
        () => new Printing(),
      );
      return { printing, calls: fake.calls };
    };
    const mac = on('macos');
    await mac.printing.print({ window: { surface: 3 }, orientation: 'landscape' });
    assert.deepEqual(mac.calls, [['printAsync', { orientation: 'landscape', window: 3 }]]);
    for (const os of ['ios', 'android', 'web'] as const) {
      const other = on(os);
      await other.printing.print({ window: { surface: 1 } });
      assert.deepEqual(other.calls, [], `nothing on ${os}`);
    }
  });

  it('renders HTML to a PDF file and answers its uri', async () => {
    const { native, calls } = platform();
    const uri = await serviceOn(native).printToPdf('<p>Hi</p>', { width: 612, height: 792 });
    assert.equal(uri, 'file:///cache/out.pdf');
    assert.deepEqual(calls, [['printToFileAsync', { html: '<p>Hi</p>', width: 612, height: 792 }]]);
  });

  it("answers the printer iOS's picker chose, and null where there is no picker", async () => {
    const { native } = platform();
    assert.deepEqual(await serviceOn(native).selectPrinter(), {
      name: 'Office',
      url: 'ipp://office',
    });
    const stand = platform({ selectPrinterAsync: undefined });
    assert.equal(await serviceOn(stand.native).selectPrinter(), null);
    const unavailable = Object.assign(new Error('not on Android'), { code: 'ERR_UNAVAILABLE' });
    const android = platform({ selectPrinterAsync: () => Promise.reject(unavailable) });
    assert.equal(await serviceOn(android.native).selectPrinter(), null, "Android's expo-print");
  });

  it('answers null when the printer picker is dismissed, and rethrows anything else', async () => {
    const cancelled = platform({
      selectPrinterAsync: () =>
        Promise.reject(
          Object.assign(new Error('Printer picker has been cancelled'), {
            code: 'E_PRINTER_PICKER_CANCELLED',
          }),
        ),
    });
    assert.equal(await serviceOn(cancelled.native).selectPrinter(), null);
    const failure = new Error('no printers');
    const failing = platform({ selectPrinterAsync: () => Promise.reject(failure) });
    await assert.rejects(serviceOn(failing.native).selectPrinter(), (error) => error === failure);
  });

  it('does nothing, and answers null, where the module has no such function or no PDF', async () => {
    const without = platform({ printAsync: undefined, printToFileAsync: undefined });
    const printing = serviceOn(without.native);
    assert.equal(await printing.print({ html: '<p />' }), undefined);
    assert.equal(await printing.print({ uri: 'file:///cache/out.pdf' }), undefined);
    assert.equal(await printing.printToPdf('<p />'), null);
    const nothing = platform({ printToFileAsync: async () => undefined as never });
    assert.equal(await serviceOn(nothing.native).printToPdf('<p />'), null);
  });

  it('is inert without the module', async () => {
    const printing = serviceOn(null);
    assert.equal(printing.available(), false);
    assert.equal(await printing.print({ html: '<p />' }), undefined);
    assert.equal(await printing.printToPdf('<p />'), null);
    assert.equal(await printing.selectPrinter(), null);
  });
});

describe('the default source', () => {
  /** `Printing` on `os`, where `expo-print` loads as `module`, and the modules it loaded. */
  function on(os: string, run: (printing: Printing, loaded: string[]) => void) {
    const global = globalThis as Record<string, unknown>;
    const loaded: string[] = [];
    global['require'] = (id: string) => {
      loaded.push(id);
      if (id === 'react-native') return { Platform: { OS: os } };
      if (id === 'expo-print') return platform().native;
      throw new Error(`Cannot find module '${id}'`);
    };
    try {
      run(injectService(Printing), loaded);
    } finally {
      delete global['require'];
      cleanup();
    }
  }

  it("is absent on the web, where expo-print's own module opens the browser's print dialog", () => {
    on('web', (printing, loaded) => {
      assert.equal(printing.available(), false);
      assert.equal(loaded.includes('expo-print'), false);
    });
  });

  it('loads expo-print on iOS and Android', () => {
    for (const os of ['ios', 'android']) {
      on(os, (printing) => assert.equal(printing.available(), true, os));
    }
  });
});
