/**
 * An Expo module this package has no service for, wrapped as the package wraps its own: a token
 * whose factory loads the module through `expoModule()`. The example on the Using a module page.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InjectionToken, Injector, inject, runInInjectionContext } from '@angular/core';
import { expoModule } from '@ng-native/expo';

interface NativePrint {
  printToFileAsync(options: { html: string }): Promise<{ uri: string }>;
}

declare const require: (id: string) => unknown;

const load = () => expoModule('expo-print', () => require('expo-print') as NativePrint);
const PRINT = new InjectionToken<NativePrint | null>('app.print', { factory: load });

class Printer {
  private readonly native = inject(PRINT);

  async toFile(html: string): Promise<string | null> {
    return (await this.native?.printToFileAsync({ html }))?.uri ?? null;
  }
}

const printerWith = (providers: object[]) => {
  const injector = Injector.create({ providers: providers as never });
  return runInInjectionContext(injector, () => new Printer());
};

test('loads in a test, where the module is not there, and does nothing', async () => {
  // The token's own factory, which an injector made here has no root scope to run.
  const printer = printerWith([{ provide: PRINT, useFactory: load }]);
  assert.equal(await printer.toFile('<p>hi</p>'), null);
});

test('takes the fake a test provides under the token', async () => {
  const fake: NativePrint = { printToFileAsync: async () => ({ uri: 'file:///out.pdf' }) };
  const printer = printerWith([{ provide: PRINT, useValue: fake }]);
  assert.equal(await printer.toFile('<p>hi</p>'), 'file:///out.pdf');
});
