/**
 * macOS's host sends `topContextMenuSelect` and the drop events to the view they happened on.
 * They are direct events, so a menu or a drop zone inside another one does not also run the
 * handlers of the one around it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ContextMenu, FileDrop, MenuItem, View } from '@ng-native/components';
import { OS } from '@ng-native/device';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';

afterEach(cleanup);

const macos = [{ provide: OS, useValue: 'macos' }];

describe('a context menu inside a context menu on macOS', () => {
  it('runs the chosen item of the inner menu only', async () => {
    const heard: string[] = [];
    await render(
      `<view testID="outer" [contextMenu]="outerMenu">
        <view testID="inner" [contextMenu]="innerMenu"></view>
      </view>
      <ng-template #outerMenu><menu-item label="Outer" (select)="heard.push('outer')" /></ng-template>
      <ng-template #innerMenu><menu-item label="Inner" (select)="heard.push('inner')" /></ng-template>`,
      {
        imports: [View, ContextMenu, MenuItem],
        providers: macos,
        componentProperties: { heard },
      },
    );
    await settle();
    await fireEvent(screen.getByTestId('inner'), 'contextMenuSelect', { id: '0' });
    assert.deepEqual(heard, ['inner']);
  });
});

describe('a drop zone inside a drop zone on macOS', () => {
  for (const [event, payload] of [
    ['dropEnter', { files: [], text: 'x', urls: [] }],
    ['dropLeave', {}],
    ['dropPerform', { files: [], text: 'x', urls: [] }],
  ] as const) {
    it(`gives ${event} to the inner zone only`, async () => {
      const heard: string[] = [];
      await render(
        `<view testID="outer" (fileDragEnter)="heard.push('outer')" (fileDragLeave)="heard.push('outer')" (fileDrop)="heard.push('outer')">
          <view testID="inner" (fileDragEnter)="heard.push('inner')" (fileDragLeave)="heard.push('inner')" (fileDrop)="heard.push('inner')"></view>
        </view>`,
        {
          imports: [View, FileDrop],
          providers: macos,
          componentProperties: { heard },
        },
      );
      await fireEvent(screen.getByTestId('inner'), event, payload);
      await settle();
      assert.deepEqual(heard, ['inner']);
    });
  }
});
