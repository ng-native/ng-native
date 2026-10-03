import { Component } from '@angular/core';
import { View } from '@ng-native/components';

@Component({ selector: 'app-card', template: '' })
export class Card {}

/**
 * A boolean written as an attribute on an element no directive takes it as an input for: a
 * component's own host, which commits as a view.
 */
@Component({
  selector: 'boolean-attributes-fixture',
  imports: [Card, View],
  styles: `
    app-card[focusable='false'] {
      opacity: 0.5;
    }
  `,
  template: `
    <app-card id="off" focusable="false" accessible="false" collapsable="false" />
    <app-card id="on" focusable="true" accessible collapsable="true" />
    <app-card id="other" testID="false" nativeID="true" />
    <view id="typed" focusable="false"></view>
  `,
})
export class BooleanAttributesFixture {}
