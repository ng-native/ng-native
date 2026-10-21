/**
 * The manual setup guide, against the template it is the long way round to. Followed as written,
 * it has to end up on the SDK the template is on and start from `src/main.ts`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');

const guide = read('apps/documentation/src/content/guide/manual-setup.md');
const template = JSON.parse(read('template/package.json'));

/** The commands the guide gives to start a blank project. */
const start = guide.slice(
  guide.indexOf('**Create a blank project:**'),
  guide.indexOf('## Install'),
);

it("creates the blank project on the template's SDK", () => {
  const sdk = /(\d+)\./.exec(template.dependencies.expo)?.[1];
  assert.ok(sdk, 'the template names no expo version');
  assert.match(start, new RegExp(`--template blank-typescript@sdk-${sdk}\\b`));
});

it("starts the app from src/main.ts, as the template's package.json does", () => {
  assert.equal(template.main, 'src/main.ts');
  assert.match(start, /^rm App\.tsx index\.ts$/m);
  assert.match(start, /^npm pkg set main=src\/main\.ts$/m);
});
