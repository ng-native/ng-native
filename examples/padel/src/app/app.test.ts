import { Watch, type NativeWatch, type WatchPayload } from '@ng-native/expo/watch';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';
import { MatchStore } from './match/match-store.ts';

function fakeWatch() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const contexts: WatchPayload[] = [];
  const native = {
    sendMessage: () => {},
    sendMessageData: async () => '',
    updateApplicationContext: (context: WatchPayload) => contexts.push(context),
    getApplicationContext: async () => null,
    transferUserInfo: () => {},
    transferCurrentComplicationUserInfo: () => {},
    startFileTransfer: async () => '',
    getReachability: async () => true,
    getIsPaired: async () => true,
    getIsWatchAppInstalled: async () => true,
    watchEvents: {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    },
  } as unknown as NativeWatch;
  return {
    native,
    contexts,
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args),
  };
}

const start = (watch = fakeWatch()) =>
  render(App, { providers: [{ provide: Watch.SOURCE, useValue: watch.native }] });

test('scores a point from the phone and keeps the watch in step', async () => {
  const watch = fakeWatch();
  await start(watch);

  await userEvent.press(screen.getByRole('button', { name: 'Point Us' }));

  expect(await screen.findByText('15')).toBeTruthy();
  expect(screen.getByText('on the phone')).toBeTruthy();
  expect(watch.contexts.at(-1)).toMatchObject({ us: '15', them: '0' });
});

test('takes a point from the watch, answers with the score, and counts a retry once', async () => {
  const watch = fakeWatch();
  await start(watch);
  const replies: WatchPayload[] = [];

  watch.emit('message', { point: 1, id: 'a' }, (reply: WatchPayload) => replies.push(reply));
  watch.emit('message', { point: 1, id: 'a' }, (reply: WatchPayload) => replies.push(reply));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(replies).toEqual([
    expect.objectContaining({ us: '0', them: '15' }),
    expect.objectContaining({ us: '0', them: '15' }),
  ]);
  expect(await screen.findByText('on the watch')).toBeTruthy();
});

test('counts points the watch queued while the phone was away', async () => {
  const watch = fakeWatch();
  await start(watch);

  watch.emit('user-info', [
    { point: 0, id: 'q1' },
    { point: 0, id: 'q2' },
  ]);

  expect(await screen.findByText('30')).toBeTruthy();
});

test('counts every batch the watch queued, however quickly they arrive', async () => {
  const watch = fakeWatch();
  await start(watch);

  watch.emit('user-info', [{ point: 0, id: 'q1' }]);
  watch.emit('user-info', [{ point: 0, id: 'q2' }]);

  expect(await screen.findByText('30')).toBeTruthy();
});

test('keeps points already played under the rule they were played with', async () => {
  const { componentRef, detectChanges } = await start();
  const match = componentRef.injector.get(MatchStore);
  for (const team of [0, 0, 0, 1, 1, 1, 0] as const) match.point(team);

  match.goldenPoint.set(true);
  await detectChanges();

  expect(match.score().games).toEqual([0, 0]);
  expect(screen.getByText('AD')).toBeTruthy();
});

test('undoes the last point', async () => {
  await start();
  await userEvent.press(screen.getByRole('button', { name: 'Point Them' }));
  expect(await screen.findByText('15')).toBeTruthy();

  await userEvent.press(screen.getByRole('button', { name: 'Undo' }));

  expect(await screen.findByText('Tap a point here or on the watch to start.')).toBeTruthy();
});
