/**
 * `Printing`, over a fake of `expo-print` that records every call: the print dialog for HTML or a
 * file, HTML to a PDF file, and iOS's printer picker. Without the module every call is inert.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Printing, type NativePrinting } from '@ng-native/expo/printing';
import { serviceWith } from './injected.ts';

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

  it('is inert without the module', async () => {
    const printing = serviceOn(null);
    assert.equal(printing.available(), false);
    assert.equal(await printing.print({ html: '<p />' }), undefined);
    assert.equal(await printing.printToPdf('<p />'), null);
    assert.equal(await printing.selectPrinter(), null);
  });
});
