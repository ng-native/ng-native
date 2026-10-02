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
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { registerPlatformComponents } from '@ng-native/fabric';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

const declarationsOf = (css: string): Record<string, unknown> =>
  compileCss(`view { ${css} }`).rules[0].declarations;

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
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/platform-color.ts', import.meta.url)),
    );

    registerPlatformComponents('ios');
    const { getByTestId } = await render(mod['PlatformColorHost'] as Type<unknown>, {
      processColor: (value) => ({ processed: value }),
    });

    const node = getByTestId('label');
    assert.deepEqual(node.props['color'], { processed: { semantic: ['label'] } });
  });

  it('names the resource Android reads instead', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/platform-color.ts', import.meta.url)),
    );

    registerPlatformComponents('android');
    const { getByTestId } = await render(mod['PlatformColorHost'] as Type<unknown>, {
      processColor: (value) => ({ processed: value }),
    });

    const node = getByTestId('label');
    assert.deepEqual(node.props['color'], { processed: { resource_paths: ['label'] } });
  });
});
