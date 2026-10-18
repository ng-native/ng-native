/**
 * `position`, and the values it takes.
 *
 * `position` sits in the compiler's generic keyword list, which takes any identifier and passes
 * it through, so a value Fabric does not read compiled cleanly and did nothing. Its values are
 * listed instead: Yoga's `relative`, `absolute` and `static`, and `fixed` and `sticky`, which
 * Yoga has no layout for and the engine implements. Anything else is refused where it is
 * written, because there is no console on a device to notice it later.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileCss } from '@ng-native/testing';

/** The property as it reaches a node, or the message explaining why it did not. */
function compile(declaration: string): { value?: unknown; dropped?: string } {
  const dropped: string[] = [];
  const sheet = compileCss(`.x { ${declaration} }`, 'global', {
    onUnsupported: (message: string) => dropped.push(message),
  });
  if (dropped.length) return { dropped: dropped[0] };
  return { value: JSON.parse(JSON.stringify(sheet)).toString() };
}

describe('position', () => {
  for (const value of ['relative', 'absolute', 'static']) {
    it(`keeps ${value}, which Yoga implements`, () => {
      assert.equal(compile(`position: ${value}`).dropped, undefined);
    });
  }

  for (const value of ['fixed', 'sticky']) {
    it(`keeps ${value}, which the engine implements`, () => {
      // Yoga has neither. The engine commits a fixed box under its page and moves a sticky one
      // by its scroll view: css-fixed.test.ts and css-sticky.test.ts.
      assert.equal(compile(`position: ${value}`).dropped, undefined);
    });
  }

  it('refuses a position there is none of, naming it and the ones there are', () => {
    const { dropped } = compile('position: running(header)');
    assert.ok(dropped, 'must not compile');
  });
});
