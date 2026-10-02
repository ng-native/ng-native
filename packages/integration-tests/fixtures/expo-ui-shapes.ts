import { Component, signal } from '@angular/core';
import {
  UiAccessoryWidgetBackground,
  UiCapsule,
  UiCircle,
  UiEllipse,
  UiHost,
  UiLabel,
  UiLink,
  UiRectangle,
  UiRoundedRectangle,
  UiText,
  UiUnevenRoundedRectangle,
  UiZStack,
} from '../../expo/src/expo-ui-components.ts';

@Component({
  selector: 'expo-ui-shapes',
  imports: [
    UiAccessoryWidgetBackground,
    UiCapsule,
    UiCircle,
    UiEllipse,
    UiHost,
    UiLabel,
    UiLink,
    UiRectangle,
    UiRoundedRectangle,
    UiText,
    UiUnevenRoundedRectangle,
    UiZStack,
  ],
  template: `
    <ui-host>
      <ui-zstack [alignment]="alignment()">
        <ui-rectangle />
        <ui-rounded-rectangle cornerRadius="12" />
        <ui-uneven-rounded-rectangle topLeadingRadius="4" bottomTrailingRadius="8" />
        <ui-capsule cornerStyle="continuous" />
        <ui-circle />
        <ui-ellipse />
        <ui-accessory-widget-background />
        <ui-label title="Padel" systemImage="tennisball.fill" color="#d7f23c" />
        <ui-link destination="padel://score" label="Score" />
        <ui-link destination="padel://match"><ui-text>Match</ui-text></ui-link>
      </ui-zstack>
    </ui-host>
  `,
})
export class ExpoUiShapesFixture {
  readonly alignment = signal<'center' | 'topLeading' | 'bottomTrailing' | undefined>(undefined);
}
