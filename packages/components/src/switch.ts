import {
  Directive,
  Injector,
  type SimpleChanges,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
} from '@angular/core';
import { type NativeSyntheticEvent, nativePlatform } from '@ng-native/fabric';
import { ControlledModel } from './controlled-model.ts';
import { optionalBoolean } from './transforms.ts';
import { ViewBase } from './view-base.ts';

/**
 * A toggle, wired for signal forms as a `FormCheckboxControl` (`checked`, not `value`). Commits
 * as `Switch` on iOS and `AndroidSwitch` on Android.
 *
 * The two platforms spell the same props differently, so both spellings are sent and each
 * native side reads its own; a prop it does not know is ignored.
 *
 * Controlled as React Native's `Switch` is: bind `checked` and the app's value is what the switch
 * shows. The user flips it, the app keeps the old value, and a prop diff has nothing to send,
 * because the prop never changed; native is the only side that moved. So once the pass the flip
 * started has rendered, the switch compares the model with what native reported and, if they
 * differ, sends the command RN's wrapper sends - `setValue` on iOS, `setNativeValue` on Android.
 * See `ControlledModel` for how the model comes to say what the app says.
 */
@Directive({
  selector: 'switch',
  host: {
    // `disabled` is an input of ours, so it cannot reach `ngOnChanges` on the base; this is
    // the one binding that keeps the announced state in step with it.
    '[accessibilityState]': 'accessibilityStateProp()',
    '[value]': 'checked()',
    '[disabled]': 'disabled()',
    '[attr.data-disabled]': "disabled() ? '' : null",
    '[enabled]': 'enabled()',
    '[thumbTintColor]': 'thumbColor()',
    '[tintColor]': 'trackColor()?.false',
    '[trackColorForTrue]': 'trackColor()?.true',
    '[trackColorForFalse]': 'trackColor()?.false',
    '[trackTintColor]': 'checked() ? trackColor()?.true : trackColor()?.false',
    '[style.backgroundColor]': 'iosBackgroundColor()',
    '[style.borderRadius]': 'iosBackgroundColor() ? 16 : undefined',
    '(change)': 'onNativeChange($event)',
  },
})
export class Switch extends ViewBase {
  readonly checked = model<boolean>(false);
  /** Ignore touches and grey out. */
  readonly disabled = input(undefined, { transform: optionalBoolean });

  /** `Switch.js`: `accessibilityRole={props.accessibilityRole ?? 'switch'}`. */
  protected override roleByDefault(): 'switch' {
    return 'switch';
  }

  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }

  protected override checkedForAccessibility(): boolean {
    return this.checked();
  }
  /** The colour of the knob. */
  readonly thumbColor = input<string>();
  /** The track colour for each state. */
  readonly trackColor = input<{ readonly false?: string; readonly true?: string }>();
  /** iOS: the colour behind the track when off, seen where the track is transparent. */
  readonly iosBackgroundColor = input<string>(undefined, { alias: 'ios_backgroundColor' });

  protected readonly enabled = computed(() => {
    const disabled = this.disabled();
    return disabled === undefined ? undefined : !disabled;
  });

  private readonly injector = inject(Injector);
  private readonly control = new ControlledModel(this.checked, 'checked');
  /** What native reported last, until the pass it started has rendered and been compared. */
  private nativeValue: boolean | null = null;

  constructor() {
    super();
    effect(() => {
      // Android spells the value `on` and iOS the on-track colour `onTintColor`. Angular refuses
      // both as host bindings because they read as event handlers, so they go to the node.
      this.engine.setProp(this.node, 'on', this.checked());
      this.engine.setProp(this.node, 'onTintColor', this.trackColor()?.true);
    });
  }

  override ngOnChanges(changes: SimpleChanges): void {
    super.ngOnChanges(changes);
    this.control.noteChanges(changes);
  }

  protected onNativeChange(event: NativeSyntheticEvent<{ value?: boolean }>): void {
    this.nativeValue = event.nativeEvent?.value ?? false;
    this.control.propose(this.nativeValue);
    afterNextRender({ write: () => this.reconcile() }, { injector: this.injector });
  }

  /**
   * After the app's bindings have settled, not before: a flip the app accepts reaches the model
   * during change detection, and comparing any earlier would send native back the value it is
   * about to be given. A value set from code later needs none of this, as the prop changes.
   */
  private reconcile(): void {
    const native = this.nativeValue;
    this.nativeValue = null;
    const desired = this.checked();
    if (native === null || native === desired) return;
    const command = nativePlatform() === 'android' ? 'setNativeValue' : 'setValue';
    this.engine.dispatchCommand(this.node, command, [desired]);
  }
}
