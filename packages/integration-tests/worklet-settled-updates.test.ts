/**
 * Reading what Reanimated's views settled on, for the views a `[workletStyle]` drives.
 *
 * Reanimated hands each settled view over once and lets it go on the read after, so a read nobody
 * acts on loses that view's values, and a read while nothing is watched is wasted. Its own React
 * components read every half second while any is mounted; this does the same for ours.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  SettledUpdates,
  settledReader,
  type RawSettled,
  type SettledUpdate,
} from '../components/src/settled-updates.ts';

describe('settled updates', () => {
  let reads: number;
  let pending: SettledUpdate[];
  const read = () => {
    reads++;
    const updates = pending;
    pending = [];
    return updates;
  };

  beforeEach(() => {
    reads = 0;
    pending = [];
    mock.timers.enable({ apis: ['setInterval'] });
  });

  afterEach(() => mock.timers.reset());

  it('reads every half second while a view is watched, and not before or after', () => {
    const updates = new SettledUpdates(read);
    mock.timers.tick(1000);
    assert.equal(reads, 0, 'nothing is read with nothing watched');
    const stop = updates.watch(7, () => {});
    mock.timers.tick(499);
    assert.equal(reads, 0);
    mock.timers.tick(1);
    assert.equal(reads, 1);
    mock.timers.tick(500);
    assert.equal(reads, 2);
    stop();
    mock.timers.tick(1000);
    assert.equal(reads, 2, 'nor once the last view stops');
  });

  it('keeps reading while any view is still watched', () => {
    const updates = new SettledUpdates(read);
    const first = updates.watch(7, () => {});
    updates.watch(8, () => {});
    first();
    mock.timers.tick(500);
    assert.equal(reads, 1);
  });

  it('hands each view its own props, and passes over a view nobody watches or one with none', () => {
    const updates = new SettledUpdates(read);
    const heard: [number, unknown][] = [];
    updates.watch(7, (props) => heard.push([7, props]));
    updates.watch(8, (props) => heard.push([8, props]));
    pending = [
      { viewTag: 8, styleProps: { opacity: 0.5 } },
      { viewTag: 9, styleProps: { opacity: 0.1 } },
      { viewTag: 7, styleProps: null },
      { viewTag: 7, styleProps: { transform: [{ translateX: 4 }] } },
    ];
    mock.timers.tick(500);
    assert.deepEqual(heard, [
      [8, { opacity: 0.5 }],
      [7, { transform: [{ translateX: 4 }] }],
    ]);
  });

  it('leaves a view watched again under the same tag with the newer listener', () => {
    const updates = new SettledUpdates(read);
    const heard: string[] = [];
    const old = updates.watch(7, () => heard.push('old'));
    updates.watch(7, () => heard.push('new'));
    old();
    pending = [{ viewTag: 7, styleProps: { opacity: 1 } }];
    mock.timers.tick(500);
    assert.deepEqual(heard, ['new']);
  });

  it('stops once, however often it is told to', () => {
    const updates = new SettledUpdates(read);
    const first = updates.watch(7, () => {});
    updates.watch(8, () => {});
    first();
    first();
    mock.timers.tick(500);
    assert.equal(reads, 1, 'the other view is still read for');
  });

  it('tells the read which views it watches, so Reanimated lets no other view go', () => {
    let asked: ((tag: number) => boolean) | undefined;
    const updates = new SettledUpdates((isWatched) => {
      asked = isWatched;
      return [];
    });
    const stop = updates.watch(7, () => {});
    mock.timers.tick(500);
    assert.equal(asked?.(7), true);
    assert.equal(asked?.(8), false);
    updates.watch(8, () => {});
    stop();
    assert.equal(asked?.(7), false, 'and stops naming a view once it stops watching it');
    assert.equal(asked?.(8), true);
  });

  it('reads nothing where Reanimated has no settled updates to give', () => {
    const updates = new SettledUpdates(() => undefined);
    let heard = 0;
    updates.watch(7, () => heard++);
    mock.timers.tick(1000);
    assert.equal(heard, 0);
  });
});

describe('settled updates, as each Reanimated hands them over', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setInterval'] }));
  afterEach(() => mock.timers.reset());

  const heardFrom = (updates: SettledUpdates | null) => {
    const heard: unknown[] = [];
    updates?.watch(7, (props) => heard.push(props));
    mock.timers.tick(500);
    return heard;
  };

  it('4.7: one bag of style, turned back with unprocessProps', () => {
    const asked: unknown[] = [];
    const updates = settledReader(
      {
        getSettledUpdates(...args) {
          asked.push(args.length);
          return [{ viewTag: 7, styleProps: { backgroundColor: 0xff0000ff } }];
        },
      },
      {
        unprocessProps(props) {
          props['backgroundColor'] = 'blue';
        },
      },
    );
    assert.deepEqual(heardFrom(updates), [{ backgroundColor: 'blue' }]);
    assert.deepEqual(asked, [0], 'asked with nothing, as 4.7 takes nothing');
  });

  it('4.8: props and style together, turned back with unprocessSettledUpdate, for the views watched', () => {
    let isRegistered: ((tag: number) => boolean) | undefined;
    const updates = settledReader(
      {
        getSettledUpdates(isViewRegistered) {
          isRegistered = isViewRegistered;
          return [{ viewTag: 7, props: { opacity: 0.5 }, style: { backgroundColor: 0xff0000ff } }];
        },
      },
      {
        unprocessProps() {
          throw new Error('not the 4.7 inverse');
        },
        unprocessSettledUpdate(update: RawSettled) {
          update.style!['backgroundColor'] = 'blue';
        },
      },
    );
    assert.deepEqual(heardFrom(updates), [{ opacity: 0.5, backgroundColor: 'blue' }]);
    assert.equal(isRegistered?.(7), true);
    assert.equal(isRegistered?.(8), false);
  });

  it('before 4.7: nothing read, with no inverse to turn the values back with', () => {
    let reads = 0;
    const updates = settledReader({ getSettledUpdates: () => (reads++, []) }, {});
    assert.equal(updates, null);
    assert.equal(reads, 0);
  });

  it('nothing read where Reanimated has no settled updates', () => {
    assert.equal(settledReader({}, { unprocessProps() {} }), null);
  });
});
