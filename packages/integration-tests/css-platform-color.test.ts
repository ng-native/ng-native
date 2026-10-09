/**
 * The platform's own semantic colours, from a stylesheet.
 *
 * `PlatformColor('label')` is iOS's label colour and Android's `?attr/textColorPrimary`: a colour
 * the *system* defines, which already tracks dark mode, increased contrast, and the accessibility
 * settings that change all of them at once. Writing `#000` with a `dark:` override approximates
 * one of those and silently ignores the rest.
 *
 * It is the same argument as the rest of this project - use the platform's answer rather than
 * redraw it - and it belongs in CSS because a colour does.
 */
import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { registerPlatformComponents } from '@ng-native/fabric';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

const declarationsOf = (css: string): Record<string, unknown> =>
  compileCss(`view { ${css} }`).rules[0].declarations;

describe('compiling a CSS system colour', () => {
  const canvas = { platformColor: ['systemBackground', '?android:attr/colorBackground'] };
  const text = { platformColor: ['label', '?android:attr/textColorPrimary'] };

  it("is the platform's colour for the same thing, which follows light and dark", () => {
    // `Canvas` and `CanvasText` are a browser's page and its text. Left as the keyword, no view
    // reads either as a colour.
    assert.deepEqual(declarationsOf('background-color: Canvas; color: CanvasText'), {
      backgroundColor: canvas,
      color: text,
    });
    assert.deepEqual(declarationsOf('color: GrayText'), {
      color: { platformColor: ['secondaryLabel', '?android:attr/textColorSecondary'] },
    });
    assert.deepEqual(declarationsOf('color: LinkText'), {
      color: { platformColor: ['link', '?android:attr/textColorLink'] },
    });
    assert.deepEqual(declarationsOf('border-top-color: AccentColor'), {
      borderTopColor: { platformColor: ['tintColor', '?android:attr/colorAccent'] },
    });
    assert.deepEqual(declarationsOf('background-color: ButtonFace'), {
      backgroundColor: {
        platformColor: ['secondarySystemBackground', '?android:attr/colorButtonNormal'],
      },
    });
  });

  it('reads a field and a button as the page and its text, in any case', () => {
    assert.deepEqual(declarationsOf('background-color: field; color: FIELDTEXT'), {
      backgroundColor: canvas,
      color: text,
    });
    assert.deepEqual(declarationsOf('color: ButtonText'), { color: text });
  });

  it('says so for one with nothing like it, rather than passing the keyword on', () => {
    assert.throws(() => declarationsOf('background-color: Highlight'), /system colour/);
    assert.throws(() => declarationsOf('color: SelectedItemText'), /system colour/);
  });

  it('reads a deprecated one as the colour CSS says it now is', () => {
    // CSS Color 4 keeps the old names as other names for the current ones.
    assert.deepEqual(declarationsOf('background-color: Window; color: WindowText'), {
      backgroundColor: canvas,
      color: text,
    });
    assert.deepEqual(declarationsOf('background-color: Menu; color: InfoText'), {
      backgroundColor: canvas,
      color: text,
    });
    assert.deepEqual(declarationsOf('background-color: ThreeDFace'), {
      backgroundColor: {
        platformColor: ['secondarySystemBackground', '?android:attr/colorButtonNormal'],
      },
    });
    assert.deepEqual(declarationsOf('color: InactiveCaptionText'), {
      color: { platformColor: ['secondaryLabel', '?android:attr/textColorSecondary'] },
    });
    // `ActiveBorder` is `ButtonBorder`, which has no colour of the platform.
    assert.throws(() => declarationsOf('border-top-color: ActiveBorder'), /system colour/);
    assert.throws(() => declarationsOf('box-shadow: 0 0 2px WindowText'), /system colour/);
  });

  it('leaves every other colour as it was', () => {
    assert.deepEqual(declarationsOf('color: red; background-color: transparent'), {
      color: 'rgb(255, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
    });
  });

  it('says so inside a shadow, where the platform resolves no colour by name', () => {
    assert.throws(() => declarationsOf('box-shadow: 0 0 2px GrayText'), /system colour/);
  });
});

describe('compiling a platform colour', () => {
  it('holds the names, because which one is right is a runtime question', () => {
    // The same declaration is `{semantic:[...]}` on iOS and `{resource_paths:[...]}` on Android,
    // and a build step that produced either would be a stylesheet that only works on one.
    assert.deepEqual(declarationsOf('color: platform-color(label)'), {
      color: { platformColor: ['label'] },
    });
  });

  it('keeps a fallback list, which is how one name covers both platforms', () => {
    // iOS calls it `label`; Android calls it `?attr/textColorPrimary`. Native takes the first that
    // resolves, so one declaration can name both.
    assert.deepEqual(declarationsOf('color: platform-color(label, "?attr/textColorPrimary")'), {
      color: { platformColor: ['label', '?attr/textColorPrimary'] },
    });
  });

  it('says to quote a name that is not a plain word, rather than taking half of it', () => {
    // `?attr/textColorPrimary` is several tokens, so an unquoted one would silently become
    // `?` or `attr` - a colour that never resolves and never says why.
    assert.throws(
      () => declarationsOf('color: platform-color(?attr/textColorPrimary)'),
      /Quote it/,
    );
  });

  it('works anywhere a colour does', () => {
    assert.deepEqual(declarationsOf('background-color: platform-color(systemBackground)'), {
      backgroundColor: { platformColor: ['systemBackground'] },
    });
    assert.deepEqual(declarationsOf('border-top-color: platform-color(separator)'), {
      borderTopColor: { platformColor: ['separator'] },
    });
  });

  it('refuses one with no name, which could only be a colour that never resolves', () => {
    assert.throws(() => declarationsOf('color: platform-color()'), /platform-color/);
  });
});

describe('resolving one on a device', () => {
  // Back to iOS whatever a test registered, so a failed assertion leaves no Android behind.
  afterEach(() => registerPlatformComponents('ios'));

  it('becomes the shape the platform reads, and goes through processColor like any colour', async () => {
    const mod = await compileFixture('fixtures/platform-color.ts');

    registerPlatformComponents('ios');
    const { getByTestId } = await render(mod['PlatformColorHost'] as Type<unknown>, {
      processColor: (value) => ({ processed: value }),
    });

    const node = getByTestId('label');
    assert.deepEqual(node.props['color'], { processed: { semantic: ['label'] } });
  });

  it('names the resource Android reads instead', async () => {
    const mod = await compileFixture('fixtures/platform-color.ts');

    registerPlatformComponents('android');
    const { getByTestId } = await render(mod['PlatformColorHost'] as Type<unknown>, {
      processColor: (value) => ({ processed: value }),
    });

    const node = getByTestId('label');
    assert.deepEqual(node.props['color'], { processed: { resource_paths: ['label'] } });
  });
});
