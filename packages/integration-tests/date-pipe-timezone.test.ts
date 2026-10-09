/**
 * `DatePipe` with a timezone argument, on a JavaScript engine whose `Date.parse` reads ISO 8601
 * and nothing else, which is Hermes.
 *
 * Angular turns the argument into an offset by parsing `'Jan 01, 1970 00:00:00 ' + timezone`, a
 * legacy form every browser reads and Hermes does not, and falls back to the device's own zone
 * when that is `NaN`. So every timezone was ignored on device, without a word. Node reads the form,
 * so the test stands Hermes' parser in before anything mounts.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const nodeParse = Date.parse;
/** Hermes' `Date.parse`: ISO 8601, and `NaN` for the legacy form. */
const hermesParse = (value: string): number => (ISO.test(value) ? nodeParse(value) : NaN);

describe('DatePipe timezones on Hermes', () => {
  const warnings: string[] = [];
  const warn = console.warn;

  let Zones: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/date-zones.ts');
    Zones = mod['DateZones'] as Type<unknown>;
    Date.parse = hermesParse;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  });

  after(() => {
    Date.parse = nodeParse;
    console.warn = warn;
  });

  afterEach(cleanup);

  const text = (node: { children: { props: Record<string, unknown> }[] }) =>
    node.children.map((child) => child.props['text']).join('');

  it('formats in the zone asked for', async () => {
    const { getByTestId } = await render(Zones, { dev: true });
    assert.equal(text(getByTestId('utc')), '14:30');
    assert.equal(text(getByTestId('zero')), '14:30');
    assert.equal(text(getByTestId('five')), '19:30');
    assert.equal(text(getByTestId('colon')), '09:00');
    assert.equal(text(getByTestId('est')), '09:30');
  });

  it('says once, in development, when a zone cannot be honoured', async () => {
    await render(Zones, { dev: true });
    const said = warnings.filter((line) => line.includes("'Europe/Paris'"));
    assert.equal(said.length, 1, warnings.join('\n'));
    assert.match(said[0]!, /Intl\.DateTimeFormat/);
  });

  it('gives Date.parse the legacy form as a browser reads it, and nothing more', () => {
    // Wrapped by the renders above, over the stand-in for Hermes' parser.
    const parseLegacyDate = Date.parse;
    assert.equal(parseLegacyDate('Jan 01, 1970 00:00:00 UTC'), 0);
    assert.equal(parseLegacyDate('Jan 01, 1970 00:00:00 +0500'), -5 * 3_600_000);
    assert.equal(parseLegacyDate('Jan 01, 1970 00:00:00 GMT-0130'), 90 * 60_000);
    assert.equal(parseLegacyDate('Jan 01, 1970 00:00:00'), new Date(1970, 0, 1).getTime());
    assert.ok(Number.isNaN(parseLegacyDate('Jan 01, 1970 00:00:00 Mars/Olympus')));
    assert.ok(Number.isNaN(parseLegacyDate('tomorrow')));
  });
});
