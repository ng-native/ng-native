/**
 * Fixture for `color-scheme.test.ts`. See `button-app.ts` for why a `@Component` lives out here.
 */
import { Component, inject } from '@angular/core';
import { ColorScheme } from '@ng-native/device';
import { Text } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Text],
  template: `<text>{{ scheme.current() }}</text>`,
})
export class ColorSchemeApp {
  readonly scheme = inject(ColorScheme);
}
