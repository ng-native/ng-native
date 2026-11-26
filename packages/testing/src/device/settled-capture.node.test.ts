/** A screenshot's captures: taken again until two agree, and until native has mounted the view. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { screenshot } from './screenshot.ts';
import { settledCapture } from './settled-capture.ts';

/** A capture that answers each call with the next of `answers`: a PNG, or an error to throw. */
function captures(...answers: (string | Error)[]) {
  let calls = 0;
  const capture = async () => {
    const answer = answers[Math.min(calls++, answers.length - 1)]!;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { capture, calls: () => calls };
}

describe('a settled capture', () => {
  it('waits for native to mount a view the commit just made, then captures it', async () => {
    // Android mounts a commit on its UI thread after the frame the test waited for.
    const { capture } = captures(
      new Error('No view with tag 41'),
      new Error('No view with tag 41'),
      'card',
      'card',
    );
    assert.equal(await settledCapture(capture, 1000), 'card');
  });

  it('waits for a view to reach the window on iOS and macOS too', async () => {
    const { capture } = captures(new Error('No view with tag 41 is in a window'), 'card', 'card');
    assert.equal(await settledCapture(capture, 1000), 'card');
  });

  it(
    'gives up on a view that never mounts at the deadline, with native error',
    { timeout: 5000 },
    async () => {
      const { capture, calls } = captures(new Error('No view with tag 41'));
      const started = Date.now();
      await assert.rejects(settledCapture(capture, 60), /No view with tag 41/);
      assert.ok(Date.now() - started >= 60, 'waited for the deadline');
      assert.ok(calls() > 1, 'asked again before giving up');
    },
  );

  it('does not wait out any other error', async () => {
    const { capture, calls } = captures(new Error('Screenshots need Android 8 (API 26) or later'));
    await assert.rejects(settledCapture(capture, 1000), /Android 8/);
    assert.equal(calls(), 1);
  });

  it('takes captures until two in a row agree', async () => {
    const { capture } = captures('a', 'b', 'c', 'c');
    assert.equal(await settledCapture(capture, 1000), 'c');
  });

  it('gives up on captures that keep changing at the deadline', async () => {
    let n = 0;
    await assert.rejects(
      settledCapture(async () => String(n++), 30),
      /did not settle within 30ms/,
    );
  });

  it('is how screenshot() captures a node the test just rendered', async () => {
    const asked: number[] = [];
    const NgNativeTesting = {
      capture: async () => 'window',
      captureView: async (tag: number) => {
        asked.push(tag);
        if (asked.length === 1) throw new Error(`No view with tag ${tag}`);
        return 'card';
      },
    };
    const global = globalThis as { expo?: unknown };
    const before = global.expo;
    global.expo = { modules: { NgNativeTesting } };
    try {
      const node = { reactTag: 41 } as Parameters<typeof screenshot>[0];
      assert.equal(await screenshot(node, { timeout: 1000 }), 'card');
      assert.deepEqual(asked, [41, 41, 41]);
    } finally {
      global.expo = before;
    }
  });
});
