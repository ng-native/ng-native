import { withComponentInputBinding } from '@angular/router';
import { ColorScheme } from '@ng-native/device';
import { Storage } from '@ng-native/expo/async-storage';
import { Store } from '@ng-native/expo/store';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { cleanup, fireEvent, render, screen, userEvent, waitFor } from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import { search } from './settings-model.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

describe('the settings search', () => {
  test('finds rows by title and by the words they are known by', () => {
    expect(search('wi').map((row) => row.id)).toEqual(['wifi']);
    expect(search('dark mode').map((row) => row.id)).toEqual(['display']);
    expect(search('  ')).toEqual([]);
  });
});

/** A store over `data`, as the disk a relaunched app reads again. A read fails with `broken`. */
function disk(data = new Map<string, string>(), broken = false) {
  return new Store({
    get: async (key) => {
      if (broken) throw new Error('unreadable');
      return data.get(key) ?? null;
    },
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  });
}

async function boot(path: string, scheme: (string | null)[] = [], store = disk()) {
  const app = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      { provide: Storage, useValue: store },
      {
        provide: ColorScheme.SOURCE,
        useValue: {
          current: () => 'light',
          subscribe: () => () => {},
          set: (s: string | null) => void scheme.push(s),
        },
      },
    ],
  });
  await app.componentRef.injector.get(NativeNavigation).push(path);
  return app;
}

describe('settings', () => {
  test('the Airplane Mode row switches, and Wi-Fi says it is off', async () => {
    await boot('/settings');
    const row = await screen.findByRole('switch', { name: 'Airplane Mode' }, asyncWait);
    expect(screen.getByLabelText('Wi-Fi, Morgan Home')).toBeTruthy();
    await userEvent.press(row);
    await screen.findByLabelText('Wi-Fi, Off', undefined, asyncWait);
    expect(
      screen.getByRole('switch', { name: 'Airplane Mode' }).props['accessibilityState'],
    ).toEqual({ checked: true });
  });

  test('picking Dark sets the whole app dark, and Automatic hands it back', async () => {
    const asked: (string | null)[] = [];
    await boot('/settings/display', asked);
    await screen.findByRole('radio', { name: 'Dark' }, asyncWait);
    asked.length = 0;
    await userEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(asked).toEqual(['dark']));
    await fireEvent(screen.getByRole('switch', { name: 'Automatic' }), 'change', { value: true });
    await waitFor(() => expect(asked).toEqual(['dark', null]));
  });

  test('the appearance chosen is kept, and applied when the app next starts', async () => {
    const data = new Map<string, string>();
    const first = disk(data);
    await boot('/settings/display', [], first);
    await userEvent.press(await screen.findByRole('radio', { name: 'Dark' }, asyncWait));
    await first.flush();
    cleanup();
    // A screen that does not use the settings: the shell applies the choice as the app starts.
    const asked: (string | null)[] = [];
    const second = disk(data);
    const app = await boot('/notes', asked, second);
    await waitFor(() => expect(asked).toEqual(['dark']));
    // Another key read later, as another screen does, applies nothing again.
    second.signal('elsewhere', 0);
    await waitFor(() => expect(second.ready()).toBe(true));
    expect(asked).toEqual(['dark']);
    await app.componentRef.injector.get(NativeNavigation).push('/settings');
    await screen.findByLabelText('Display & Brightness, Dark', undefined, asyncWait);
  });

  test('a choice that cannot be read back leaves the scheme alone, and a new one applies', async () => {
    const asked: (string | null)[] = [];
    const store = disk(new Map([['appearance', JSON.stringify('dark')]]), true);
    await boot('/settings/display', asked, store);
    await waitFor(() => expect(store.error()).not.toBeNull());
    await screen.findByRole('radio', { name: 'Light' }, asyncWait);
    expect(asked).toEqual([]);
    await fireEvent(screen.getByRole('switch', { name: 'Automatic' }), 'change', { value: false });
    await waitFor(() => expect(asked).toEqual(['light']));
  });

  test('Wi-Fi joins the network pressed', async () => {
    await boot('/settings/wifi');
    await userEvent.press(
      await screen.findByRole('button', { name: 'Cafe Nero Guest, 2 bars' }, asyncWait),
    );
    await screen.findByLabelText('Cafe Nero Guest, connected', undefined, asyncWait);
  });
});
