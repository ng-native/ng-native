/**
 * `render()`'s `on`, which listens to a component's outputs as a template binding does: one a
 * host directive forwards included, and a name the component has no output by refused by name.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, output } from '@angular/core';
import { PressBehavior, Text } from '@ng-native/components';
import { cleanup, render, screen, userEvent } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'app-button',
  imports: [Text],
  template: '<text>Save</text>',
  hostDirectives: [{ directive: PressBehavior, outputs: ['press'] }],
  host: { accessibilityRole: 'button' },
})
class Button {
  readonly saved = output<string>({ alias: 'done' });
}

test('hears an output a host directive forwards', async () => {
  const presses: unknown[] = [];
  await render(Button, { on: { press: (event: unknown) => presses.push(event) } });
  await userEvent.press(screen.getByRole('button'));
  assert.equal(presses.length, 1);
});

test("hears the component's own output by the name a template binds", async () => {
  const heard: string[] = [];
  const { instance } = await render(Button, { on: { done: (value: string) => heard.push(value) } });
  instance.saved.emit('yes');
  assert.deepEqual(heard, ['yes']);
});

test('refuses a name the component has no output by, naming both', async () => {
  await assert.rejects(
    render(Button, { on: { pres: () => {} } }),
    (error: Error) => /pres\b/.test(error.message) && /Button/.test(error.message),
  );
});
