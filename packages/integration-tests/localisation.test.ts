/**
 * Localisation with `@angular/localize` itself, end to end: what the guide at
 * `guide/localization.md` says works, run against the compiler the Metro preset uses.
 *
 * Marking text, loading translations before the root renders, choosing the language from
 * `Locale`, formatting with Angular's locale data, and extracting the messages with
 * `localize-extract`. Also the one thing that does not work the way it looks as if it should:
 * loading new translations into a running app does not change a template that has already been
 * shown, which is why the guide switches language by reloading.
 */
import '@angular/localize/init';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import {
  LOCALE_ID,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import { clearTranslations, loadTranslations, ɵcomputeMsgId } from '@angular/localize';
import { Locale, type LocaleLike, type NativeLocale } from '@ng-native/expo/locale';
import { cleanup, screen, render, settle } from '@ng-native/testing';
import type { FakeFabricNode } from '@ng-native/testing';
import { compileFixture, compileToCode } from './compile.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/localisation.ts', import.meta.url));

const rawText = (node: FakeFabricNode): string =>
  node.viewName === 'RawText'
    ? String(node.props['text'] ?? '')
    : node.children.map(rawText).join('');
const textOf = (id: string) => rawText(screen.getByTestId(id));

/** A message with no custom ID is looked up by a hash of its text and meaning. */
const TITLE_ID = ɵcomputeMsgId('Welcome', 'home screen');

const FRENCH = {
  greeting: 'Bonjour, {$INTERPOLATION} !',
  [TITLE_ID]: 'Bienvenue',
  startHint: 'Touchez {$START_TAG_TEXT}ici{$CLOSE_TAG_TEXT} pour commencer',
  saveButton: 'Enregistrer',
  closeLabel: 'Fermer',
  basketCount:
    '{VAR_PLURAL, plural, =0 {Aucun article&#1114112;} one {Un article} other {{INTERPOLATION} articles &amp; plus}}',
  found: '{VAR_PLURAL, plural, one {{INTERPOLATION} résultat} other {{INTERPOLATION} résultats}}',
  'reply.mine': 'Vous avez répondu',
  'reply.theirs': '{$INTERPOLATION} a répondu',
  'basket.empty': 'Votre panier est vide',
  'basket.one': 'Un article',
  'basket.other': '# articles',
};

let fixture: Record<string, unknown>;
before(async () => {
  fixture = await compileFixture(FIXTURE);
});
afterEach(cleanup);
after(clearTranslations);

describe('marking text, with a translation loaded before the first render', () => {
  before(() => loadTranslations(FRENCH));

  it('translates a message by its custom ID, placeholders included', async () => {
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('greeting'), 'Bonjour, Ada !');
  });

  it('translates a message with no custom ID by the ID computed from its text and meaning', async () => {
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('title'), 'Bienvenue');
  });

  it('keeps an element inside a message, moved to where the translation puts it', async () => {
    // Threw in development builds, `Right-hand side of 'instanceof' is not callable`, while the
    // polyfilled `Node` was a plain object.
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('nested'), 'Touchez ici pour commencer');
    assert.equal(textOf('inner'), 'ici');
  });

  it('translates $localize in a component, the way to translate an attribute', async () => {
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('save'), 'Enregistrer');
    assert.equal(screen.getByTestId('save').props['accessibilityLabel'], 'Enregistrer');
  });

  it('translates an attribute marked with i18n-', async () => {
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(screen.getByTestId('close').props['accessibilityLabel'], 'Fermer');
  });

  it('translates a plural, reading a character reference in a case as the character', async () => {
    const { instance } = await render(fixture['Messages'] as Type<unknown>);
    // One past the last code point: U+FFFD as HTML makes it, where `fromCodePoint` threw.
    assert.equal(textOf('basket'), 'Aucun article\ufffd');
    const count = (instance as { count: { set(n: number): void } }).count;
    count.set(1);
    await settle();
    assert.equal(textOf('basket'), 'Un article');
    count.set(3);
    await settle();
    assert.equal(textOf('basket'), '3 articles & plus');
  });

  it('selects between messages with @switch', async () => {
    const { instance } = await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('reply'), 'Vous avez répondu');
    (instance as { author: { set(v: string): void } }).author.set('them');
    await settle();
    assert.equal(textOf('reply'), 'Ada a répondu');
  });
});

describe('switching language in a running app', () => {
  before(() => {
    clearTranslations();
    loadTranslations({ greeting: 'Hallo, {$INTERPOLATION}!', saveButton: 'Speichern' });
  });

  it('does not change a template already shown, even after unmounting it', async () => {
    // A component's template messages are read once, the first time the component renders
    // anywhere in the app, and kept for as long as the JavaScript runtime lives.
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('greeting'), 'Bonjour, Ada !');
  });

  it('does change $localize in a component created after the switch', async () => {
    await render(fixture['Messages'] as Type<unknown>);
    assert.equal(textOf('save'), 'Speichern');
  });
});

/**
 * The guide's `provideLocalisation`, with the translations and the stored choice passed in where
 * the guide imports them and reads `expo-secure-store`.
 */
function provideLocalisation(
  translations: Record<string, Record<string, string>>,
  stored: string | null = null,
): EnvironmentProviders {
  const chooseLanguage = (preferred: readonly (string | null)[]): string =>
    preferred.find((code) => code === 'en' || (code != null && code in translations)) ?? 'en';

  return makeEnvironmentProviders([
    {
      provide: LOCALE_ID,
      useFactory: () =>
        chooseLanguage([
          stored,
          ...inject(Locale)
            .locales()
            .map((locale) => locale.languageCode),
        ]),
    },
    provideAppInitializer(() => {
      const messages = translations[inject(LOCALE_ID)];
      if (messages) loadTranslations(messages);
    }),
  ]);
}

function deviceIn(...tags: string[]): { provide: unknown; useValue: NativeLocale } {
  const locales = tags.map((tag): LocaleLike => ({
    languageTag: tag,
    languageCode: tag.split('-')[0] ?? null,
    regionCode: tag.split('-')[1] ?? null,
    textDirection: 'ltr',
    measurementSystem: 'metric',
  }));
  return {
    provide: Locale.SOURCE,
    useValue: { locales: () => locales, calendars: () => [], onChange: () => () => {} },
  };
}

describe('choosing the language from the device, before the root renders', () => {
  before(() => {
    clearTranslations();
    registerLocaleData(localeFr);
  });

  it('uses the first of the device languages the app has, and formats for it', async () => {
    await render(fixture['Formatted'] as Type<unknown>, {
      providers: [deviceIn('de-DE', 'fr-FR', 'en-GB'), provideLocalisation({ fr: FRENCH })],
    });
    assert.equal(textOf('items'), 'Votre panier est vide');
    assert.equal(textOf('date'), '24 septembre 2026');
    assert.equal(textOf('number'), '1 234 567,89');
    assert.equal(textOf('price'), '1 234,50 €');
  });

  it('picks the case of a template plural by the rules of LOCALE_ID, not of en-US', async () => {
    // Zero is `one` in French and `other` in English. The i18n runtime reads the locale Angular's
    // own bootstrap tells it, which nothing told it here: every language was counted in English.
    await render(fixture['Formatted'] as Type<unknown>, {
      providers: [deviceIn('fr-FR'), provideLocalisation({ fr: FRENCH })],
    });
    assert.equal(textOf('found'), '0 résultat');
  });

  it('picks a plural form by the language rules, with an exact match first', async () => {
    const { instance } = await render(fixture['Formatted'] as Type<unknown>, {
      providers: [deviceIn('fr-FR'), provideLocalisation({ fr: FRENCH })],
    });
    const count = (instance as { count: { set(n: number): void } }).count;
    count.set(1);
    await settle();
    assert.equal(textOf('items'), 'Un article');
    count.set(3);
    await settle();
    assert.equal(textOf('items'), '3 articles');
  });
});

describe('a language chosen in the app', () => {
  before(() => clearTranslations());

  it('wins over the device languages', async () => {
    await render(fixture['Formatted'] as Type<unknown>, {
      providers: [deviceIn('en-GB'), provideLocalisation({ fr: FRENCH }, 'fr')],
    });
    assert.equal(textOf('items'), 'Votre panier est vide');
    assert.equal(textOf('date'), '24 septembre 2026');
  });
});

describe('falling back when the device has no language the app has', () => {
  before(() => clearTranslations());

  it('shows the source text and formats in the source locale', async () => {
    // A separate component type would be needed to see the source *template* text here, since
    // `Formatted` has rendered in French already; its `$localize` forms and pipes are per instance.
    await render(fixture['Formatted'] as Type<unknown>, {
      providers: [deviceIn('ja-JP'), provideLocalisation({ fr: FRENCH })],
    });
    assert.equal(textOf('items'), 'Your basket is empty');
    assert.equal(textOf('date'), 'September 24, 2026');
    assert.equal(textOf('price'), '€1,234.50');
  });
});

describe('extracting messages with localize-extract', () => {
  const require = createRequire(import.meta.url);
  const cli = path.join(
    path.dirname(require.resolve('@angular/localize/package.json')),
    'tools/bundles/src/extract/cli.js',
  );
  let dir: string;
  let messages: Record<string, string>;

  before(() => {
    // What Metro's bundle holds for this file: the compiler's output with the types removed.
    dir = mkdtempSync(path.join(tmpdir(), 'localise-'));
    const js = stripTypeScriptTypes(compileToCode(FIXTURE).code, { mode: 'strip' });
    writeFileSync(path.join(dir, 'localisation.js'), js);

    const run = spawnSync(
      process.execPath,
      [cli, '-r', dir, '-s', '*.js', '-f', 'json', '-o', 'messages.json'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    messages = JSON.parse(readFileSync(path.join(dir, 'messages.json'), 'utf8')).translations;
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('finds template messages and $localize strings, with their placeholders', () => {
    assert.equal(messages['greeting'], 'Hello, {$INTERPOLATION}!');
    assert.equal(messages['startHint'], 'Tap {$START_TAG_TEXT}here{$CLOSE_TAG_TEXT} to start');
    assert.equal(messages['saveButton'], 'Save');
    assert.equal(messages['closeLabel'], 'Close');
    assert.equal(
      messages['basketCount'],
      '{VAR_PLURAL, plural, =0 {No items} one {One item} other {{INTERPOLATION} items}}',
    );
    assert.equal(messages['basket.other'], '# items');
  });

  it('writes a message with no custom ID under the ID the runtime looks it up by', () => {
    assert.equal(messages[TITLE_ID], 'Welcome');
  });
});
