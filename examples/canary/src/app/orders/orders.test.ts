import { Router, withComponentInputBinding } from '@angular/router';
import { AppState, type AppStatus } from '@ng-native/device';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { render, screen, settle, userEvent, waitFor } from '@ng-native/testing';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import { ORDER_POLL_MS, OrdersApi } from './orders-api.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const realSleep = globalThis.setTimeout;

/** Most fake milliseconds a wait may take before it gives up, so a regression fails, not hangs. */
const FAKE_WAIT_LIMIT_MS = 3000;

interface FakeClock {
  /** Move the clock on until `done` holds, or fail naming `what` once the limit passes. */
  until(done: () => boolean, what: string): Promise<void>;
  /** Move the clock on until `pending` settles, and resolve to what it resolved to. */
  drive<R>(pending: Promise<R>, what: string): Promise<R>;
}

/**
 * Run `work` under a fake clock that only moves when this moves it: one millisecond at a time,
 * with a real pause between steps so work that is not a timer (the lazy screen's import) can
 * finish. Nothing depends on how fast the machine is, only on how much fake time has passed, and
 * no wait outlasts FAKE_WAIT_LIMIT_MS of it, so the real clock is always restored.
 */
async function onFakeClock<T>(work: (clock: FakeClock) => Promise<T>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  try {
    const until = async (done: () => boolean, what: string) => {
      for (let elapsed = 0; !done(); elapsed++) {
        if (elapsed >= FAKE_WAIT_LIMIT_MS) {
          throw new Error(
            `Gave up after ${FAKE_WAIT_LIMIT_MS} ms of fake time waiting for ${what}`,
          );
        }
        await new Promise((resolve) => realSleep(resolve, 2));
        await vi.advanceTimersByTimeAsync(1);
      }
    };
    const drive = async <R>(pending: Promise<R>, what: string): Promise<R> => {
      let settled = false;
      const result = pending.finally(() => (settled = true));
      result.catch(() => undefined);
      await until(() => settled, what);
      return result;
    };
    return await work({ until, drive });
  } finally {
    vi.useRealTimers();
  }
}

async function boot() {
  const api = new OrdersApi();
  api.latency = 20;
  let state: AppStatus = 'active';
  const listeners = new Set<(state: AppStatus) => void>();
  const app = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      { provide: OrdersApi, useValue: api },
      { provide: ORDER_POLL_MS, useValue: 80 },
      {
        provide: AppState.SOURCE,
        useValue: {
          current: () => state,
          subscribe: (listener: (state: AppStatus) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    ],
  });
  const injector = app.componentRef.injector;
  const nav = injector.get(NativeNavigation);
  const goTo = (next: AppStatus) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };
  return { ...app, api, nav, router: injector.get(Router), goTo };
}

describe('orders', () => {
  test('shows the order the screen opened on', async () => {
    const { nav } = await boot();
    await nav.push('/orders/o1');
    await screen.findByText('Status: placed', undefined, asyncWait);
    expect(screen.getByText('Order o1, version 1')).toBeTruthy();
  });

  test('moving to the next order drops the answer still coming for the first', async () => {
    const { nav, api } = await boot();
    api.slow.set('o1', 300);
    await nav.push('/orders/o1');
    await waitFor(() => expect(api.requests).toBeGreaterThan(0), asyncWait);
    await userEvent.press(screen.getByRole('button', { name: 'Next order' }));
    await screen.findByText('Order o2, version 1', undefined, asyncWait);
    expect(api.aborted).toBeGreaterThanOrEqual(1);
    await wait(400);
    expect(screen.queryByText(/Order o1,/)).toBeNull();
    expect(screen.getByText(/Order o2,/)).toBeTruthy();
  });

  test('asks again while in front, and the order moves on', async () => {
    const { nav } = await boot();
    await nav.push('/orders/o3');
    await screen.findByText('Status: placed', undefined, asyncWait);
    await screen.findByText('Status: preparing', undefined, asyncWait);
  });

  test('stops asking while another screen is on top, and starts again when back', async () => {
    const { nav, api } = await boot();
    await nav.push('/orders/o4');
    await screen.findByText('Status: placed', undefined, asyncWait);
    await userEvent.press(screen.getByRole('button', { name: 'All orders' }));
    await waitFor(
      () => expect(screen.getAllByText('Order o1').length).toBeGreaterThan(0),
      asyncWait,
    );
    await wait(60);
    const covered = api.requests;
    await wait(400);
    expect(api.requests).toBe(covered);
    nav.back();
    for (let turn = 0; turn < 4; turn++) await settle();
    await waitFor(() => expect(api.requests).toBeGreaterThan(covered), asyncWait);
  });

  test('stops asking while the app is in the background', async () => {
    const { nav, api, goTo } = await boot();
    await nav.push('/orders/o5');
    await screen.findByText('Status: placed', undefined, asyncWait);
    goTo('background');
    await settle();
    await wait(60);
    const away = api.requests;
    await wait(400);
    expect(api.requests).toBe(away);
    goTo('active');
    await waitFor(() => expect(api.requests).toBeGreaterThan(away), asyncWait);
  });

  test('leaving the screen cancels its request and its polling', async () => {
    const { nav, api, router } = await boot();
    api.slow.set('o6', 500);
    await nav.push('/orders/o6');
    await waitFor(() => expect(api.requests).toBeGreaterThan(0), asyncWait);
    nav.back();
    await waitFor(() => expect(router.url).toBe('/'), asyncWait);
    for (let turn = 0; turn < 4; turn++) await settle();
    expect(api.aborted).toBeGreaterThanOrEqual(1);
    const after = api.requests;
    await wait(400);
    expect(api.requests).toBe(after);
  });

  test('keeps asking a server slower than the poll, and hears each answer', async () => {
    const { nav, api } = await boot();
    api.latency = 200; // longer than the 80 ms between polls
    await nav.push('/orders/o9');
    await screen.findByText('Status: placed', undefined, asyncWait);
    await screen.findByText('Status: preparing', undefined, asyncWait);
  });

  test('cancels once however often tapped, and a poll already on its way cannot undo it', async () => {
    const { nav, api } = await boot();
    await onFakeClock(async ({ until, drive }) => {
      await drive(nav.push('/orders/o7'), 'the screen to open');
      await until(() => screen.queryByText('Status: placed') !== null, 'the order to show');
      // A slow poll leaves before the cancel and lands after it, with the status it was asked for.
      api.slow.set('o7', 250);
      const requests = api.requests;
      await until(() => api.requests > requests, 'a poll to leave');
      const button = screen.getByRole('button', { name: 'Cancel order' });
      const aborted = api.aborted;
      await drive(userEvent.press(button), 'the tap to finish');
      await drive(userEvent.press(button), 'the tap to finish');
      // The cancel's own answer, 20 ms away, not the poll's, 270 ms away.
      await until(
        () => screen.queryByText('Status: cancelled') !== null,
        'the order to show cancelled',
      );
      expect(api.cancels).toBe(1);
      expect(api.aborted, 'setting the order dropped the poll on its way').toBe(aborted + 1);
      // Well past when the poll would have landed.
      await vi.advanceTimersByTimeAsync(500);
      expect(screen.queryByText('Status: placed')).toBeNull();
      expect(screen.getByText('Status: cancelled')).toBeTruthy();
    });
  });

  test('says when the order cannot be loaded, and loads it on retry', async () => {
    const { nav, api } = await boot();
    api.failing = true;
    await nav.push('/orders/o8');
    await screen.findByText('The order could not be loaded.', undefined, asyncWait);
    api.failing = false;
    await userEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Status: placed', undefined, asyncWait);
  });
});
