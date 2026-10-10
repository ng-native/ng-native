import { Component, input } from '@angular/core';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { UiButton, UiHStack, UiSpacer, UiText, UiVStack } from '@ng-native/expo/expo-ui-components';
import { createLiveActivity } from '@ng-native/expo/live-activity';

export interface Scoreline {
  us: string;
  them: string;
  games: string;
  sets: string;
  winner: string;
}

/**
 * The score on the lock screen and in the Dynamic Island. The widget extension draws it from the
 * source `createLiveActivity` has it compiled to, so it holds only its props, modifiers and literals.
 * A tap on one of the banner's buttons is a point, which the app scores.
 */
@Component({
  selector: 'score-activity',
  imports: [UiButton, UiHStack, UiSpacer, UiText, UiVStack],
  template: `
    @let big = font({ size: 34, weight: 'heavy', design: 'rounded' });
    @let compact = font({ weight: 'bold', design: 'rounded' });
    @let expanded = font({ size: 28, weight: 'heavy', design: 'rounded' });
    <ng-template #banner>
      <ui-hstack [modifiers]="[padding({ all: 16 })]">
        <ui-vstack>
          <ui-text [modifiers]="[font({ size: 13, weight: 'semibold' }), foregroundStyle(muted)]">
            @if (props().winner) {
              {{ props().winner }} win
            } @else {
              Sets {{ props().sets }} Games {{ props().games }}
            }
          </ui-text>
          <ui-text [modifiers]="[big]">Us {{ props().us }} - {{ props().them }} Them</ui-text>
        </ui-vstack>
        <ui-spacer />
        <ui-vstack>
          <ui-button target="us" label="Us" />
          <ui-button target="them" label="Them" />
        </ui-vstack>
      </ui-hstack>
    </ng-template>
    <ng-template #compactLeading>
      <ui-text [modifiers]="[compact, foregroundStyle(ball)]">{{ props().us }}</ui-text>
    </ng-template>
    <ng-template #compactTrailing>
      <ui-text [modifiers]="[compact]">{{ props().them }}</ui-text>
    </ng-template>
    <ng-template #minimal>
      <ui-text [modifiers]="[compact, foregroundStyle(ball)]">{{ props().us }}</ui-text>
    </ng-template>
    <ng-template #expandedLeading>
      <ui-text [modifiers]="[expanded, foregroundStyle(ball)]">Us {{ props().us }}</ui-text>
    </ng-template>
    <ng-template #expandedTrailing>
      <ui-text [modifiers]="[expanded]">{{ props().them }} Them</ui-text>
    </ng-template>
    <ng-template #expandedBottom>
      <ui-text [modifiers]="[font({ size: 14 }), foregroundStyle(muted)]">
        Sets {{ props().sets }} Games {{ props().games }}
      </ui-text>
    </ng-template>
  `,
})
class ScoreLayout {
  readonly props = input.required<Scoreline>();
  protected readonly font = font;
  protected readonly foregroundStyle = foregroundStyle;
  protected readonly padding = padding;
  protected readonly ball = '#d7f23c';
  protected readonly muted = '#8fa3c9';
}

export const scoreActivity = createLiveActivity('PadelScore', ScoreLayout);
