/**
 * A modal's own events reach its own handler only. React Native lists `ModalHostView`'s
 * `topRequestClose`, `topShow`, `topDismiss` and `topOrientationChange` as direct events, so a
 * modal presented from inside another one does not hand its Escape, its back button or its
 * dismissal to the one around it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Modal } from '@ng-native/components';
import { cleanup, fireEvent, render, screen } from '@ng-native/testing';

afterEach(cleanup);

describe('a modal inside a modal', () => {
  for (const event of ['requestClose', 'show', 'dismiss', 'orientationChange']) {
    it(`gives (${event}) to the inner modal only`, async () => {
      const heard: string[] = [];
      await render(
        `<modal testID="outer" (${event})="heard.push('outer')">
          <modal testID="inner" (${event})="heard.push('inner')"></modal>
        </modal>`,
        { imports: [Modal], componentProperties: { heard } },
      );
      await fireEvent(screen.getByTestId('inner'), event);
      assert.deepEqual(heard, ['inner']);
    });
  }
});
