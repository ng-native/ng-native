import { Component, input } from '@angular/core';
import { ControlBase } from './pressable.ts';
import { numberOr } from './transforms.ts';

/**
 * A pressable that dims while pressed, as RN's `TouchableOpacity` does.
 *
 * The fade is a CSS transition rather than a JavaScript tween: a rule sets the pressed opacity and
 * the engine eases to it. React Native's own timings are asymmetric - 150ms in, 250ms out - which
 * is a thing CSS expresses exactly, because the duration in force is the one on the state being
 * entered. That is what the two rules below are.
 *
 * Nothing here states the resting opacity, so whatever the cascade gives the host is what a press
 * eases back to: a class, Tailwind's, an inline `[style]` or a bound `[style.opacity]`, read when
 * the press ends as `TouchableOpacity.js` reads its style, and followed as it changes. An opacity
 * nothing sets is still 1 to ease from and to. The pressed rule is `!important` because a
 * caller's inline opacity outranks this component's host bindings and plain rules alike, and
 * would otherwise keep it from dimming at all; `activeOpacity` reaches it as a custom property,
 * which no caller's style sets.
 */
@Component({
  selector: 'touchable-opacity',
  template: `<ng-content />`,
  exportAs: 'touchableOpacity',
  styles: `
    :host {
      transition: opacity 250ms ease-in-out;
    }
    :host(.pressed) {
      opacity: var(--touchable-active-opacity, 0.2) !important;
      transition: opacity 150ms ease-in-out;
    }
  `,
  host: {
    '[style.--touchable-active-opacity]': 'activeOpacity()',
    '[class.pressed]': 'pressed()',
  },
})
export class TouchableOpacity extends ControlBase {
  /** `TouchableOpacity.js`: `accessible={this.props.accessible !== false}`, and focusable too. */
  protected override accessibleByDefault(): boolean {
    return true;
  }

  protected override focusableByDefault(): boolean {
    return true;
  }

  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }

  protected override pressDisabled(): boolean {
    return this.disabledByAnyState();
  }

  /** The opacity while pressed. */
  readonly activeOpacity = input(0.2, { transform: numberOr(0.2) });
}
