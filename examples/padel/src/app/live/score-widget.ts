import { Component, input } from '@angular/core';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { UiButton, UiHStack, UiSpacer, UiText, UiVStack } from '@ng-native/expo/expo-ui-components';
import { createWidget } from '@ng-native/expo/live-activity';
import type { WidgetEnvironment } from 'expo-widgets';
import type { Scoreline } from './score-activity.ts';

/**
 * The score on the home screen, with a button for each side. A tap shows the next point at once
 * and records itself for the app, which applies it with the full rules and writes the score back.
 */
@Component({
  selector: 'score-widget',
  imports: [UiButton, UiHStack, UiSpacer, UiText, UiVStack],
  template: `
    @let small = environment().widgetFamily === 'systemSmall';
    @let points = font({ size: small ? 30 : 40, weight: 'heavy', design: 'rounded' });
    @let label = font({ size: small ? 13 : 15, weight: 'semibold' });
    <ui-vstack [modifiers]="[padding({ all: small ? 2 : 8 })]">
      <ui-text [modifiers]="[font({ size: 12, weight: 'semibold' }), foregroundStyle(muted)]">
        @if (props().winner) {
          {{ props().winner }} win
        } @else if (small) {
          Games {{ props().games }}
        } @else {
          Sets {{ props().sets }} Games {{ props().games }}
        }
      </ui-text>
      <ui-hstack>
        <ui-text [modifiers]="[points, foregroundStyle(green)]">{{ props().us }}</ui-text>
        <ui-spacer />
        <ui-text [modifiers]="[points]">{{ props().them }}</ui-text>
      </ui-hstack>
      <ui-hstack>
        <ui-button target="us" (buttonPress)="{ us: next[props().us] ?? '0' }">
          <ui-text [modifiers]="[label]">Us</ui-text>
        </ui-button>
        <ui-spacer />
        <ui-button target="them" (buttonPress)="{ them: next[props().them] ?? '0' }">
          <ui-text [modifiers]="[label]">Them</ui-text>
        </ui-button>
      </ui-hstack>
    </ui-vstack>
  `,
})
class ScoreWidgetLayout {
  readonly props = input.required<Scoreline>();
  readonly environment = input.required<WidgetEnvironment>();
  protected readonly font = font;
  protected readonly foregroundStyle = foregroundStyle;
  protected readonly padding = padding;
  protected readonly green = '#6b8a00';
  protected readonly muted = '#8fa3c9';
  protected readonly next: Record<string, string> = { '0': '15', '15': '30', '30': '40' };
}

export const scoreWidget = createWidget('PadelScoreWidget', ScoreWidgetLayout);
