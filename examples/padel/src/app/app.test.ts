import { Watch, type NativeWatch, type WatchPayload } from '@ng-native/expo/watch';
import { render, screen, userEvent } from '@ng-native/testing';
import { beforeEach, expect, test, vi } from 'vitest';
import { App } from './app.ts';
import type { Scoreline } from './live/score-activity.tsx';
import { MatchStore } from './match/match-store.ts';

const lockScreen = vi.hoisted(() => {
  const shown: unknown[] = [];
  const ended: unknown[] = [];
  let running = false;
  const activity = {
    getId: () => 'activity-1',
    update: async (props: unknown) => void shown.push(props),
    end: async (dismissal: unknown) => void ((running = false), ended.push(dismissal)),
    getPushToken: async () => null,
    addPushTokenListener: () => ({ remove: () => {} }),
  };
  return {
    shown,
    ended,
    reset: () => ((shown.length = 0), (ended.length = 0), (running = false)),
    factory: {
      start: (props: unknown) => {
        running = true;
        shown.push(props);
        return activity;
      },
      getInstances: () => (running ? [activity] : []),
    },
  };
});

vi.mock('./live/score-activity.tsx', () => ({ scoreActivity: lockScreen.factory }));

beforeEach(() => lockScreen.reset());

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

  watch.emit('message', { point: 1, rally: 'a' }, (reply: WatchPayload) => replies.push(reply));
  watch.emit('message', { point: 1, rally: 'a' }, (reply: WatchPayload) => replies.push(reply));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(replies).toEqual([
    expect.objectContaining({ us: '0', them: '15' }),
    expect.objectContaining({ us: '0', them: '15' }),
  ]);
  expect(await screen.findByText('on the watch')).toBeTruthy();
});

test('counts a point once when its reply failed and the watch queued it again', async () => {
  const watch = fakeWatch();
  await start(watch);

  // iOS hands over a message that wants a reply with its id replaced by the reply's own, so the
  // live copy and the one the watch queued after its reply failed carry different ids.
  watch.emit('message', { point: 0, rally: 'w1', id: 'reply-1' }, () => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  watch.emit('user-info', [
    { point: 0, rally: 'w1' },
    { point: 1, rally: 'w2' },
  ]);

  await screen.findByText('Them won the point');
  expect(screen.getAllByText('15')).toHaveLength(2);
});

test('counts points the watch queued while the phone was away', async () => {
  const watch = fakeWatch();
  await start(watch);

  watch.emit('user-info', [
    { point: 0, rally: 'q1' },
    { point: 0, rally: 'q2' },
  ]);

  expect(await screen.findByText('30')).toBeTruthy();
});

test('counts every batch the watch queued, however quickly they arrive', async () => {
  const watch = fakeWatch();
  await start(watch);

  watch.emit('user-info', [{ point: 0, rally: 'q1' }]);
  watch.emit('user-info', [{ point: 0, rally: 'q2' }]);

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

test('puts the score on the lock screen and keeps it in step', async () => {
  await start();

  await userEvent.press(screen.getByRole('button', { name: 'Show on lock screen' }));
  await userEvent.press(screen.getByRole('button', { name: 'Point Us' }));

  expect(await screen.findByRole('button', { name: 'On the lock screen' })).toBeTruthy();
  expect(lockScreen.shown.at(-1)).toMatchObject({
    us: '15',
    them: '0',
  } satisfies Partial<Scoreline>);

  await userEvent.press(screen.getByRole('button', { name: 'On the lock screen' }));
  expect(await screen.findByRole('button', { name: 'Show on lock screen' })).toBeTruthy();
  // Gone at once: an ended activity iOS keeps on the lock screen sits over the next one started.
  expect(lockScreen.ended).toEqual(['immediate']);
});
