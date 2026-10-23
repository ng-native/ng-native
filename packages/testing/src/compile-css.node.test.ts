/**
 * `compileCss()`, which compiles a sheet as the build compiles an app's, and as it compiles a
 * library's where it is asked for `generated`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileCss } from '@ng-native/testing';

const BEFORE = '.chip::before { content: "*"; color: red }';

test("refuses an app's sheet a box of its own before an element", () => {
  const dropped: string[] = [];
  compileCss(BEFORE, 'app.css', { onUnsupported: (message) => dropped.push(message) });
  assert.equal(dropped.length, 1);
});

test("keeps the box in a sheet compiled as the build compiles a library's", () => {
  const dropped: string[] = [];
  const sheet = compileCss(BEFORE, 'library.css', {
    generated: true,
    onUnsupported: (message) => dropped.push(message),
  });
  assert.deepEqual(dropped, []);
  assert.ok(sheet.rules.length > 0);
});
