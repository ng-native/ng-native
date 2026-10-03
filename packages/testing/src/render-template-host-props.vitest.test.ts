/**
 * `render()` with a template string, of a component that binds native props on its own host.
 *
 * The host component the template is compiled into is the one component in a test compiled just
 * in time, and Angular checks the properties bound on an element against the schemas of the
 * template it is in. So every native prop a component bound on its host, the ones `PressBehavior`
 * binds included, logged NG0303 from a test that passed.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { Component } from '@angular/core';
import { PressBehavior, Text } from '@ng-native/components';
import { cleanup, render, screen } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'app-button',
  template: '<ng-content />',
  hostDirectives: [{ directive: PressBehavior, outputs: ['press'] }],
  host: { '[accessibilityLabel]': '"Save"' },
})
class Button {}

test('renders a component that binds native props on its host with nothing logged', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await render('<app-button><text>One</text></app-button>', { imports: [Button, Text] });
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual([]);
    expect(screen.getByLabelText('Save')).toBeTruthy();
  } finally {
    error.mockRestore();
  }
});
