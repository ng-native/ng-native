/** Which simulator an iOS run uses. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pick } from './ios-launcher.ts';

const ios = (major: number) => `com.apple.CoreSimulator.SimRuntime.iOS-${major}-0`;
const device = (name: string, major: number, state = 'Shutdown') => ({
  udid: `${name}-${major}`,
  name,
  state,
  runtime: ios(major),
});

describe('the simulator an iOS run picks', () => {
  const all = [
    device('iPhone 16', 26),
    device('iPad Air', 27),
    device('iPhone 17 Pro', 26, 'Booted'),
    device('iPhone 17 Pro', 27),
    device('iPhone 18', 27),
  ];

  it('is the one named, booted first, then on the newest iOS', () => {
    assert.equal(pick(all, 'iPhone 17 Pro').udid, 'iPhone 17 Pro-26', 'the booted one');
    assert.equal(
      pick(
        all.map((each) => ({ ...each, state: 'Shutdown' })),
        'iPhone 17 Pro',
      ).udid,
      'iPhone 17 Pro-27',
      'none booted: the newest iOS',
    );
  });

  it('without a name, is a booted iPhone, or else the first iPhone on the newest iOS', () => {
    assert.equal(pick(all, undefined).udid, 'iPhone 17 Pro-26');
    assert.equal(
      pick(
        all.map((each) => ({ ...each, state: 'Shutdown' })),
        undefined,
      ).udid,
      'iPhone 17 Pro-27',
    );
  });

  it('names the simulators there are when the one asked for is missing', () => {
    assert.throws(
      () => pick(all, 'iPhone 99'),
      /No iOS simulator named "iPhone 99". Available: iPhone 16, iPad Air/,
    );
    assert.throws(() => pick([device('iPad Air', 27)], undefined), /No iPhone simulator/);
  });
});
