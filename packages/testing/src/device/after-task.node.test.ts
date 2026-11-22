/** A test's teardown in the device runner, and what runs after it however it went. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { teardownThen } from './after-task.ts';

describe('the end of a device test', () => {
  it('restores animations after a teardown that throws, and reports the teardown error', async () => {
    let restored = false;
    await assert.rejects(
      teardownThen(
        () => {
          throw new Error('cleanup');
        },
        async () => {
          restored = true;
        },
      ),
      /cleanup/,
    );
    assert.equal(restored, true);
  });

  it('keeps the teardown error when restoring fails too', async () => {
    await assert.rejects(
      teardownThen(
        async () => {
          throw new Error('cleanup');
        },
        async () => {
          throw new Error('restore');
        },
      ),
      /cleanup/,
    );
  });

  it('reports a restore that fails after a clean teardown', async () => {
    await assert.rejects(
      teardownThen(
        () => {},
        async () => {
          throw new Error('restore');
        },
      ),
      /restore/,
    );
  });
});
