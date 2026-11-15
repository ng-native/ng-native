import { Network } from '@ng-native/expo/network';
import { render, screen, userEvent, waitFor } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { FakeNotesApi, NOTES_API } from './api/notes-api.ts';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

const offline = {
  current: async () => ({ connected: false, type: 'none', reachable: false }) as const,
  subscribe: () => () => {},
};

test('makes a note from File > New Note on macOS', async () => {
  await render(App, {
    os: 'macos',
    providers: [
      ...appConfig.providers,
      { provide: NOTES_API, useValue: new FakeNotesApi([], { latencyMs: 0, failureRate: 0 }) },
      { provide: Network.SOURCE, useValue: offline },
    ],
  });
  expect(await userEvent.keyboard('mod+n')).toBe(true);
  await waitFor(() => expect(screen.getByPlaceholderText(/title/i)).toBeTruthy(), {
    timeout: 10_000,
  });
});
