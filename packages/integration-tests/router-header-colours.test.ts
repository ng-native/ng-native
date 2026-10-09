/**
 * A header bar's colour when the app never named one.
 *
 * A native header is configured with props, and a prop cannot read the cascade, so `backgroundColor`
 * left unset means each platform decides for itself. iOS follows the system appearance and looks
 * broadly right. Android takes the app theme's `colorPrimary`, which is the framework's default
 * blue - so every screen of every app built here had a blue bar above a themed screen, and the
 * props that would fix it worked but nobody had bound them.
 *
 * The defaults are shadcn's `--background` and `--foreground`, written out because there is no way
 * for a prop to read them, and replaceable through `NATIVE_HEADER_PALETTE` for an app that retunes
 * its palette.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { signal, type Type } from '@angular/core';
import { ColorScheme, OS_VERSION, type Scheme } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, screen } from '@ng-native/testing';
import { NATIVE_HEADER_DEFAULTS } from '../router/src/native-bar-defaults.ts';
import { NATIVE_HEADER_PALETTE } from '../router/src/native-header-palette.ts';
import { compileFixture } from './compile.ts';

describe('a header nobody gave a colour', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/header-colours.ts');
  });

  const bar = async (name: string, scheme: Scheme, palette?: unknown) => {
    await render(mod[name] as Type<unknown>, {
      providers: [
        {
          provide: ColorScheme.SOURCE,
          useValue: { current: () => scheme, subscribe: () => () => {} },
        },
        ...(palette ? [{ provide: NATIVE_HEADER_PALETTE, useValue: palette }] : []),
      ],
    });
    const props = screen.getByTestId('bar').props;
    cleanup();
    return props;
  };

  it('takes the light background rather than the platform default', async () => {
    const props = await bar('HeaderDefault', 'light');
    assert.equal(props['backgroundColor'], 'rgb(255, 255, 255)');
    assert.equal(props['color'], 'rgb(10, 10, 10)');
    assert.equal(props['titleColor'], 'rgb(10, 10, 10)', 'the title too, not just the tint');
  });

  it('follows the scheme, which is the half iOS already did and Android did not', async () => {
    const props = await bar('HeaderDefault', 'dark');
    assert.equal(props['backgroundColor'], 'rgb(10, 10, 10)');
    assert.equal(props['color'], 'rgb(250, 250, 250)');
  });

  it('never overrides a colour the call site named', async () => {
    // The defaults fill gaps. A header that says `backgroundColor` means it, and its foreground
    // still comes from the palette, because those are two separate questions.
    const props = await bar('HeaderBound', 'light');
    assert.equal(props['backgroundColor'], '#ff0000');
    assert.equal(props['color'], 'rgb(10, 10, 10)');
  });

  it('takes an app palette over the built-in one', async () => {
    const props = await bar('HeaderDefault', 'light', {
      light: { background: '#123456', foreground: '#abcdef' },
      dark: { background: '#000000', foreground: '#ffffff' },
    });
    assert.equal(props['backgroundColor'], '#123456');
    assert.equal(props['color'], '#abcdef');
  });
});

describe('a header in an app that asks for the Liquid Glass bar', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/header-colours.ts');
  });

  const bar = async (name: string, version: number | null, defaults: object | null) => {
    await render(mod[name] as Type<unknown>, {
      providers: [
        { provide: OS_VERSION, useValue: version },
        ...(defaults ? [{ provide: NATIVE_HEADER_DEFAULTS, useValue: signal(defaults) }] : []),
      ],
    });
    const props = screen.getByTestId('bar').props;
    cleanup();
    return props;
  };

  it('is clear, over the content, with no line under it, on iOS 26', async () => {
    const props = await bar('HeaderDefault', 26, { liquidGlass: true });
    assert.equal(props['backgroundColor'], 'transparent');
    assert.equal(props['translucent'], true);
    assert.equal(props['hideShadow'], true);
    assert.equal(props['color'], 'rgb(10, 10, 10)', 'the foreground is still the palette');
  });

  it('is the neutral bar where nobody asked, on iOS 26 too', async () => {
    for (const defaults of [null, {}, { liquidGlass: false }]) {
      const props = await bar('HeaderDefault', 26, defaults);
      assert.equal(props['backgroundColor'], 'rgb(255, 255, 255)');
      assert.equal(props['translucent'], undefined);
      assert.equal(props['hideShadow'], undefined);
    }
  });

  it('is the neutral bar before iOS 26, and on Android', async () => {
    const before26 = await bar('HeaderDefault', 18, { liquidGlass: true });
    assert.equal(before26['backgroundColor'], 'rgb(255, 255, 255)');
    assert.equal(before26['translucent'], undefined);

    registerPlatformComponents('android');
    try {
      const android = await bar('HeaderDefault', 36, { liquidGlass: true });
      assert.equal(android['backgroundColor'], 'rgb(255, 255, 255)');
      assert.equal(android['translucent'], undefined);
    } finally {
      registerPlatformComponents('ios');
    }
  });

  it('stays the bar a call site or the defaults gave a background', async () => {
    const bound = await bar('HeaderBound', 26, { liquidGlass: true });
    assert.equal(bound['backgroundColor'], '#ff0000');
    assert.equal(bound['translucent'], undefined);
    assert.equal(bound['hideShadow'], undefined);

    const coloured = await bar('HeaderDefault', 26, { liquidGlass: true, backgroundColor: '#0f0' });
    assert.equal(coloured['backgroundColor'], '#0f0');
    assert.equal(coloured['translucent'], undefined);
  });

  it('is asked for by one header, where the app did not', async () => {
    const props = await bar('HeaderGlass', 26, null);
    assert.equal(props['backgroundColor'], 'transparent');
    assert.equal(props['translucent'], true);
    assert.equal(props['hideShadow'], true);
    assert.equal(props['liquidGlass'], undefined, 'and is not a prop of the native bar');
  });

  it('is refused by one header, where the app asked', async () => {
    await render(mod['HeaderGlass'] as Type<unknown>, {
      inputs: { glass: false },
      providers: [
        { provide: OS_VERSION, useValue: 26 },
        { provide: NATIVE_HEADER_DEFAULTS, useValue: signal({ liquidGlass: true }) },
      ],
    });
    const props = screen.getByTestId('bar').props;
    cleanup();
    assert.equal(props['backgroundColor'], 'rgb(255, 255, 255)');
    assert.equal(props['translucent'], undefined);
  });

  it('gives way to a call site that turns translucency off', async () => {
    const props = await bar('HeaderLargeOpaque', 26, { liquidGlass: true });
    assert.equal(props['translucent'], false);
  });
});

describe('a large title nobody configured', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/header-colours.ts');
  });

  const bar = async (name: string) => {
    await render(mod[name] as Type<unknown>);
    const props = screen.getByTestId('bar').props;
    cleanup();
    return props;
  };

  it('is drawn as iOS draws one: over the content, clear at the top, collapsing as it scrolls', async () => {
    // Since iOS 26 the large title sits in the scroll view, above its content, and a bar with a
    // background there paints over it; and over an opaque bar the inline title never fades in.
    const props = await bar('HeaderLarge');
    assert.equal(props['translucent'], true);
    assert.equal(props['largeTitleBackgroundColor'], 'transparent');
    assert.equal(props['largeTitleHideShadow'], true);
  });

  it('never overrides what the call site asked for', async () => {
    const props = await bar('HeaderLargeOpaque');
    assert.equal(props['translucent'], false);
    assert.equal(props['largeTitleBackgroundColor'], '#ff0000');
    assert.equal(props['largeTitleHideShadow'], false);
  });

  it('leaves a header without one alone', async () => {
    const props = await bar('HeaderDefault');
    assert.equal(props['translucent'], undefined);
    assert.equal(props['largeTitleBackgroundColor'], undefined);
  });
});
