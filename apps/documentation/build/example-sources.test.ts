import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { highlightFile, languageOf } from './example-sources.ts';
import { highlight } from './markdown.ts';

describe('the language a file is highlighted as', () => {
  let root: string;

  const write = (file: string, text: string) => {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'example-sources-'));
    write(
      'src/app/card/card.ts',
      `@Component({ selector: 'card', templateUrl: './card.html' })\nexport class Card {}\n`,
    );
    write('src/app/card/card.html', `@if (open()) {\n  <text>{{ title() }}</text>\n}\n`);
    write(
      'src/app/card/framed-card.ts',
      `@Component({\n  selector: 'framed-card',\n  templateUrl: "../shared/frame.html",\n})\nexport class FramedCard {}\n`,
    );
    write('src/app/shared/frame.html', `<view><ng-content /></view>\n`);
    write(
      'src/app/badge.ts',
      `@Component({ selector: 'badge', template: \`<text>{{ label() }}</text>\` })\nexport class Badge {}\n`,
    );
    write(
      'src/app/money.ts',
      `/**\n * Formats cents for a @Component({ template }) to show.\n */\nexport const format = (cents: number) => (cents / 100).toFixed(2);\n`,
    );
    write('src/index.html', `<!doctype html>\n<div id="root"></div>\n`);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("a component's .ts is Angular", () => {
    expect(languageOf(root, 'src/app/badge.ts')).toBe('angular-ts');
    expect(languageOf(root, 'src/app/card/card.ts')).toBe('angular-ts');
  });

  test('a .ts with no component in it is TypeScript, even one that mentions a component', () => {
    expect(languageOf(root, 'src/app/money.ts')).toBe('ts');
  });

  test('a .html some component names as its templateUrl is Angular, wherever it lives', () => {
    expect(languageOf(root, 'src/app/card/card.html')).toBe('angular-html');
    expect(languageOf(root, 'src/app/shared/frame.html')).toBe('angular-html');
  });

  test('a .html no component names is HTML', () => {
    expect(languageOf(root, 'src/index.html')).toBe('html');
  });
});

describe('a component, highlighted', () => {
  const workspace = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..');
  const wallet = path.join(workspace, 'examples/wallet');
  const file = 'src/app/home/home.ts';

  // Not the same as TypeScript's highlighting, so the inline template is Angular's; and not the
  // same as plain text, which is what `highlight` quietly falls back to for a grammar not loaded.
  test("highlights its inline template with Angular's grammar", async () => {
    const text = readFileSync(path.join(wallet, file), 'utf8').trimEnd() + '\n';
    const html = await highlightFile(wallet, file);
    expect(html).toBe(await highlight(text, 'angular-ts'));
    expect(html).not.toBe(await highlight(text, 'ts'));
    expect(html).not.toBe(await highlight(text, 'text'));
  });
});
