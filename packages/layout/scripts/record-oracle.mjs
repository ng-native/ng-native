/**
 * Record where Chrome puts every box of every fixture, and commit it as `oracle/chrome.json`.
 *
 * Chrome is consulted here, once, not during the tests. Each fixture's root sits in a wrapper of
 * its own, and every box starts from React Native's defaults (the same ones `@ng-native/web`'s
 * reset gives an element), so a `display: block` is a block among flex columns, which is what it
 * would be in an app.
 *
 *   node scripts/record-oracle.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, fixtureMarkup, fixtureNames } from '../src/fixture.ts';
import { VIEWPORT } from '../src/yoga-baseline.ts';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(existsSync);
if (!CHROME) throw new Error('no Chrome to record with');

const names = fixtureNames();
const html = `<!doctype html><meta charset="utf-8"><style>
${readFileSync(join(FIXTURES, 'ahem.css'), 'utf8')}
body { margin: 0; }
/* React Native's defaults, as packages/web/src/reset.css gives them to an element. */
div { display: flex; flex-direction: column; box-sizing: border-box; position: relative;
  flex-shrink: 0; min-width: 0; min-height: 0; margin: 0; padding: 0; border: 0 solid black; }
/* A device has no scrollbar gutter. */
::-webkit-scrollbar { display: none; }
.case { position: absolute; left: 0; top: 0; align-items: flex-start;
  font: 10px/1 ahem; }
.content-box, .content-box * { box-sizing: content-box; }
.border-box, .border-box * { box-sizing: border-box; }
.ltr * { direction: ltr; }
.rtl * { direction: rtl; }
</style>
<body>${names.map((name) => `<div class="case" data-case="${name}">${fixtureMarkup(name)}</div>`).join('\n')}
<script>
document.fonts.ready.then(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el, parent) => {
    const r = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return [round(r.left - p.left), round(r.top - p.top), round(r.width), round(r.height),
      [...el.children].map((child) => box(child, el))];
  };
  const out = {};
  for (const el of document.querySelectorAll('.case')) out[el.dataset.case] = box(el.firstElementChild, el);
  document.body.textContent = 'RESULT:' + JSON.stringify(out) + ':END';
});
</script></body>`;

const file = join(mkdtempSync(join(tmpdir(), 'layout-oracle-')), 'page.html');
writeFileSync(file, html);
const dom = execFileSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--virtual-time-budget=5000',
    '--dump-dom',
    file,
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024 },
);
const match = dom.match(/RESULT:(\{.*\}):END/s);
if (!match) throw new Error('the page reported nothing; did Chrome run its script?');
const oracle = JSON.parse(match[1]);
const missing = names.filter((name) => !oracle[name]);
if (missing.length) throw new Error(`Chrome recorded no box for ${missing.join(', ')}`);
const lines = names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(oracle[name])}`);
writeFileSync(
  fileURLToPath(new URL('../oracle/chrome.json', import.meta.url)),
  `{\n${lines.join(',\n')}\n}\n`,
);
console.log(`recorded ${names.length} fixtures`);
