/**
 * Angular's platform id as a browser's, for the components under the one that asks for it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { provideBrowserPlatformId, provideWebCompat } from './index.ts';

const seen: Record<string, boolean> = {};

@Component({ selector: 'x-reads', template: '' })
class Reads {
  constructor() {
    seen['inside'] = isPlatformBrowser(inject(PLATFORM_ID));
  }
}

@Component({
  selector: 'x-library-page',
  imports: [Reads],
  providers: [provideBrowserPlatformId()],
  template: '<x-reads />',
})
class LibraryPage {}

@Component({ selector: 'x-app', imports: [LibraryPage], template: '<x-library-page />' })
class App {
  constructor() {
    seen['outside'] = isPlatformBrowser(inject(PLATFORM_ID));
  }
}

describe('provideBrowserPlatformId', () => {
  afterEach(cleanup);

  it('says a browser to what is under the component given it, and to nothing else', async () => {
    // A library opens its overlay only where Angular says it is in a browser; the app's own
    // code reads the same id to know it is on a device.
    await render(App, { providers: [provideWebCompat()] });
    assert.deepEqual(seen, { outside: false, inside: true });
  });
});
