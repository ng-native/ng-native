import { Component, signal } from '@angular/core';
import { UiHost, UiText, UiVStack } from '../../expo/src/expo-ui-components.ts';

/**
 * Text a widget layout and an app must show alike: `widget-layout-parity.test.ts` renders this
 * template in an app and compiles the `ui-vstack` in it, as written here, as a widget layout.
 */
@Component({
  selector: 'widget-layout-parity',
  imports: [UiHost, UiText, UiVStack],
  template: `
    <ui-host>
      <ui-vstack>
        <ui-text>Us {{ props().us }} - {{ props().them }} Them</ui-text>
        <ui-text> Sets {{ props().sets }} Games {{ props().games }} </ui-text>
        <ui-text
          >Hello
          @if (props().on) {
            there
          }
        </ui-text>
        <ui-text>
          @if (props().winner) {
            {{ props().winner }} win
          } @else {
            Sets {{ props().sets }}
          }
        </ui-text>
        <ui-text>{{ props().missing }}</ui-text>
        <ui-text>&nbsp;Gap&nbsp;&nbsp;here</ui-text>
        <ui-text>{{ props().player?.name ?? 'nobody' }} serves</ui-text>
        <ui-text text="bound">content</ui-text>
        <ui-text>{{ props().us }}{{ props().them }}</ui-text>
      </ui-vstack>
    </ui-host>
  `,
})
export class WidgetLayoutParityFixture {
  readonly props = signal<Record<string, unknown>>({});
}
