/**
 * Fixture for `device-sources.test.ts`. See `button-app.ts` for why a `@Component` lives out here.
 */
import { Component, inject } from '@angular/core';
import { Direction, OS, Screen } from '@ng-native/device';
import { Text, View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Text, View],
  template: `<view
    ><text>{{ screen.window().width }}</text></view
  >`,
})
export class DeviceApp {
  readonly screen = inject(Screen);
  readonly direction = inject(Direction);
  readonly os = inject(OS);
}
