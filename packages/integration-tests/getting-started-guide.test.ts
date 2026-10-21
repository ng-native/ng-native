/**
 * Getting started shows the files the template generates. Each block is compared with the
 * template's own file, so a change to one without the other fails here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');

const guide = read('apps/documentation/src/content/guide/getting-started.md');

/** The first `ts` block after `marker`, as written. */
function blockAfter(marker: string): string {
  const at = guide.indexOf(marker);
  assert.notEqual(at, -1, `the guide has no "${marker}"`);
  const start = guide.indexOf('```ts\n', at) + '```ts\n'.length;
  return guide.slice(start, guide.indexOf('```', start));
}

it("shows the template's src/app/app.ts", () => {
  assert.equal(blockAfter('The template generates this'), read('template/src/app/app.ts'));
});

it("shows the template's src/app/app.test.ts", () => {
  assert.equal(blockAfter('## Run `app.test.ts`'), read('template/src/app/app.test.ts'));
});
