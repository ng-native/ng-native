import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  untracked,
} from '@angular/core';
import { ControlBase } from './pressable.ts';

/**
 * A pressable that dims while pressed, as RN's `TouchableOpacity` does.
 *
 * The fade is a CSS transition rather than a JavaScript tween: the component sets the target
 * opacity and the engine eases to it. React Native's own timings are asymmetric - 150ms in,
 * 250ms out - which is a thing CSS expresses exactly, because the duration in force is the one on
 * the state being entered. That is what the two rules below are.
 *
 * The opacity is a binding rather than a rule because `activeOpacity` is an input, and it returns
 * to `undefined` when the fade finishes so a caller's own `[style]` opacity is in charge again at
 * rest. `transitionend` is the engine's own event, the same one Angular's `animate.leave` waits
 * for.
 */
@Component({
  selector: 'touchable-opacity',
  template: `<ng-content />`,
  exportAs: 'touchableOpacity',
  styles: `
    /*
     * The resting opacity is stated rather than left out, because a transition needs a value to
     * ease *from*: a property appearing for the first time is recorded and left alone, which is
     * CSS's own rule and would make every fade in a snap. Inline style still wins over this, so a
     * caller's own opacity is untouched.
     */
    :host {
      opacity: 1;
      transition: opacity 250ms ease-in-out;
    }
    :host(.pressed) {
      transition: opacity 150ms ease-in-out;
    }
  `,
  host: {
    '[style.opacity]': 'opacity()',
    '[class.pressed]': 'pressed()',
    '(transitionend)': 'settle()',
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
  readonly activeOpacity = input(0.2, { transform: numberAttribute });

  /** Undefined at rest, so the caller's own `[style]` opacity shows through. */
  protected readonly opacity = signal<number | undefined>(undefined);

  /** What to ease back to: whatever the caller had before the press. */
  private resting = 1;

  constructor() {
    super();
    // Reacts to `pressed` alone. Reading `opacity` here would re-run the effect on the value it
    // just wrote, and a press that arrives mid-fade would restart from the wrong end.
    effect(() => {
      const pressed = this.pressed();
      untracked(() => {
        if (pressed) {
          // Remembered on the way in, so the fade out returns to it rather than to 1.
          const style = this.node.props['style'] as { opacity?: number } | undefined;
          this.resting = this.opacity() ?? style?.opacity ?? 1;
          this.opacity.set(this.activeOpacity());
        } else if (this.opacity() !== undefined) {
          this.opacity.set(this.resting);
        }
      });
    });
    // A component destroyed mid-fade leaves a transition the engine would go on advancing.
    inject(DestroyRef).onDestroy(() => this.opacity.set(undefined));
  }

  /**
   * The fade is over. Letting go of the value hands the opacity back to whatever the caller's own
   * style says, which is the same number we just eased to - so nothing moves, and a caller who
   * changes it later is not fighting a binding of ours.
   */
  protected settle(): void {
    if (!this.pressed()) this.opacity.set(undefined);
  }
}
