/**
 * A press on a switch flips it, as a tap does on a device: UISwitch, Android's switch and the
 * macOS host's switch each send `change` with the new value as the finger lifts, and a disabled
 * one sends nothing. A press reached the switch and nothing flipped it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, signal } from '@angular/core';
import { Switch } from '@ng-native/components';
import { cleanup, fireEvent, render, screen, userEvent } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'x-notifications',
  imports: [Switch],
  template: `
    <switch accessibilityLabel="Notifications" [(checked)]="on" />
    <switch
      accessibilityLabel="Locked"
      [checked]="true"
      [disabled]="true"
      (checkedChange)="flip()"
    />
  `,
})
class Notifications {
  readonly on = signal(true);
  flips = 0;
  flip(): void {
    this.flips++;
  }
}

const notifications = () => screen.getByRole('switch', { name: 'Notifications' });
const checked = () =>
  (notifications().props['accessibilityState'] as Record<string, unknown>)['checked'];

describe('a press on a switch', () => {
  for (const os of ['ios', 'android', 'macos'] as const) {
    it(`flips it on ${os}, and back`, async () => {
      const { instance } = await render(Notifications, { os });
      await userEvent.press(notifications());
      assert.equal(instance.on(), false);
      assert.equal(checked(), false);
      await userEvent.press(notifications());
      assert.equal(instance.on(), true);
      assert.equal(checked(), true);
    });
  }

  it('flips it through fireEvent.press too', async () => {
    const { instance } = await render(Notifications);
    await fireEvent.press(notifications());
    assert.equal(instance.on(), false);
  });

  it('leaves a disabled switch as it is, on iOS and on Android', async () => {
    for (const os of ['ios', 'android'] as const) {
      const { instance } = await render(Notifications, { os });
      await userEvent.press(screen.getByRole('switch', { name: 'Locked' }));
      assert.equal(instance.flips, 0, os);
      cleanup();
    }
  });
});
