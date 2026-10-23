/**
 * Where Chrome puts each box of a case: the reference.
 *
 * One headless page, kept open, lays out a batch of cases one after another. Every box is a `div`
 * that starts from React Native's defaults as `@ng-native/web`'s reset gives them (a flex column,
 * no shrinking, no automatic minimum, `border-box`, `position: relative`), under a weak `:where`
 * so the case's own rules win, inside a 400 by 800 screen that is a flex column itself. Text is in
 * the Ahem font at ten pixels and twenty a line, which is how the pipeline's fake text measures.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { boxes, hidden, stylesheet, type Case, type CaseNode } from './case.ts';
import type { Rect } from './pipeline.ts';

/**
 * Ahem, with the ascent and descent of the system fonts the engine takes a line's baseline from
 * (`FONT_ASCENT` and `FONT_DESCENT` in `engine.ts`): every glyph is still a square of its size,
 * and an empty box on a line sits where the engine has the baseline, not Ahem's own.
 */
const AHEM = readFileSync(
  fileURLToPath(new URL('../../layout/fixtures/taffy/ahem.css', import.meta.url)),
  'utf8',
).replace(
  "font-family: 'ahem';",
  "font-family: 'ahem'; ascent-override: 95%; descent-override: 24%; line-gap-override: 0%;",
);
if (!AHEM.includes('ascent-override')) throw new Error('ahem.css names its font another way');

const PAGE = `<!doctype html><meta charset="utf-8"><style>
${AHEM}
html, body { margin: 0; }
::-webkit-scrollbar { display: none; }
#screen { position: absolute; left: 0; top: 0; width: 400px; height: 800px; display: flex;
  flex-direction: column; overflow: hidden; font: 10px/20px ahem; }
:where(#screen div) { display: flex; flex-direction: column; align-items: stretch;
  box-sizing: border-box; position: relative; flex-shrink: 0; min-width: 0; min-height: 0;
  margin: 0; padding: 0; border: 0 solid black; }
:where(#screen span) { display: inline; box-sizing: border-box; position: relative;
  flex-shrink: 0; min-width: 0; min-height: 0; }
</style><style id="case"></style><div id="screen"></div>`;

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function markup(node: CaseNode, names: Map<CaseNode, string>): string {
  const text = node.text === undefined ? '' : `<span>${escape(node.text)}</span>`;
  const children = node.children.map((child) => markup(child, names)).join('');
  return `<div class="${names.get(node)}" data-box="${names.get(node)}">${text}${children}</div>`;
}

export class ChromeLayout {
  private readonly browser: Browser;
  private readonly page: Page;

  private constructor(browser: Browser, page: Page) {
    this.browser = browser;
    this.page = page;
  }

  static async open(): Promise<ChromeLayout> {
    const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await page.setContent(PAGE);
    await page.evaluate(() => document.fonts.ready.then(() => document.fonts.load('10px ahem')));
    return new ChromeLayout(browser, page);
  }

  /** Each case's boxes against the screen, in the order given. */
  async layOut(cases: readonly Case[]): Promise<Map<string, Rect>[]> {
    const inputs = cases.map((test) => {
      const names = new Map(boxes(test.root).map(({ name, node }) => [node, name]));
      return { css: stylesheet(test.root), html: markup(test.root, names) };
    });
    const results = await this.page.evaluate((all) => {
      const screen = document.getElementById('screen')!;
      const style = document.getElementById('case')!;
      return all.map(({ css, html }) => {
        style.textContent = css;
        screen.innerHTML = html;
        const origin = screen.getBoundingClientRect();
        const out: [string, number, number, number, number][] = [];
        for (const element of screen.querySelectorAll<HTMLElement>('[data-box]')) {
          const r = element.getBoundingClientRect();
          out.push([
            element.dataset['box']!,
            r.left - origin.left,
            r.top - origin.top,
            r.width,
            r.height,
          ]);
        }
        return out;
      });
    }, inputs);
    return results.map((rows, i) => {
      const skip = hidden(cases[i]!.root);
      return new Map(
        rows
          .filter(([name]) => !skip.has(name))
          .map(([name, ...rect]) => [name, rect as unknown as Rect]),
      );
    });
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
