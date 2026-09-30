import { Directive, booleanAttribute, input } from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';
import { TouchableBase } from './pressable.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';
import type { AccessibilityRole } from './view-base.ts';

export type EllipsizeMode = 'head' | 'middle' | 'tail' | 'clip';
export type DynamicTypeRamp =
  | 'caption2'
  | 'caption1'
  | 'footnote'
  | 'subheadline'
  | 'callout'
  | 'body'
  | 'headline'
  | 'title3'
  | 'title2'
  | 'title1'
  | 'largeTitle';

/**
 * A run of text. Commits as `Paragraph`, or as a span (`VirtualText`) when nested in another
 * `<text>`, which the engine decides from the tree so a nested run inherits its parent's font
 * and sits on its baseline.
 *
 * Text inherits `color`, `fontSize` and the other text properties from CSS as it does on the
 * web; from an inline `[style]` on an ancestor view it does not, exactly as in RN.
 *
 * Presses: RN makes a text pressable when a press handler is present. Angular cannot see
 * whether `(press)` is bound, so set `pressable` to opt in; the handlers, delays and long press
 * are then the same as `<pressable>`'s. iOS highlights a pressed run unless
 * `suppressHighlighting` is set.
 */
@Directive({
  selector: 'text',
  exportAs: 'text',
})
export class Text extends TouchableBase {
  /**
   * `Text.js` splits by platform: on iOS every text is an accessibility element unless refused,
   * on Android only one that can be pressed. Nothing native can infer which, so the host's
   * `Platform.OS` decides, exactly as React Native's own wrapper does.
   */
  protected override accessibleByDefault(): boolean {
    return nativePlatform() === 'android' ? this.pressable() : true;
  }

  /**
   * `Text.js` announces `disabled` on every text, pressable or not, nested or not. Written from
   * `ngOnChanges` like the rest of the state, since `disabled` is an input of this directive: no
   * host binding, which `ControlBase` needs and a text cannot afford.
   */
  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }

  /**
   * `Text.js`: a pressable text is a `link` unless a role is set or it is disabled, where
   * `disabled` wins and `aria-disabled` or `accessibilityState.disabled` stand in when it is
   * unset. Nested or not. Every input it reads is this directive's, so `ngOnChanges` keeps it
   * current without a host binding.
   */
  protected override roleByDefault(): AccessibilityRole | undefined {
    if (!this.pressable()) return undefined;
    const disabled = this.disabled() ?? this.ariaDisabled() ?? this.accessibilityState()?.disabled;
    return disabled === true ? undefined : 'link';
  }

  /** Truncate after this many lines, with `ellipsizeMode` deciding where the ellipsis goes. */
  readonly numberOfLines = input<number>(undefined, { transform: optionalNumber });
  /**
   * Where truncated text is cut. `clip` is iOS only. Defaults to `tail`, as React Native's `Text`
   * does in JavaScript: native's own default is to clip, with no ellipsis. The default is the
   * engine's, below `text-overflow` in a stylesheet, which in turn is below this input.
   */
  readonly ellipsizeMode = input<EllipsizeMode>();
  /** Let the user select and copy the text. */
  readonly selectable = input<boolean>(undefined, { transform: optionalBoolean });
  /** The highlight colour of a selection. */
  readonly selectionColor = input<string>();
  /** Scale with the system Text Size setting. Defaults to true. */
  readonly allowFontScaling = input<boolean>(undefined, { transform: optionalBoolean });
  /** The most `allowFontScaling` may scale by; 0 means no limit. */
  readonly maxFontSizeMultiplier = input<number>(undefined, { transform: optionalNumber });
  /** iOS: the Dynamic Type style this text follows. */
  readonly dynamicTypeRamp = input<DynamicTypeRamp>();
  /** iOS: shrink the font to fit `numberOfLines`. */
  readonly adjustsFontSizeToFit = input<boolean>(undefined, { transform: optionalBoolean });
  /** iOS: the smallest scale `adjustsFontSizeToFit` may shrink to, from 0.01 to 1. */
  readonly minimumFontScale = input<number>(undefined, { transform: optionalNumber });
  /** iOS: the line-breaking strategy. */
  readonly lineBreakStrategyIOS = input<'none' | 'standard' | 'hangul-word' | 'push-out'>();
  /** Android: the line-breaking strategy. */
  readonly textBreakStrategy = input<'simple' | 'highQuality' | 'balanced'>();
  /** Android: turn phone numbers, links and addresses into tappable text. */
  readonly dataDetectorType = input<'phoneNumber' | 'link' | 'email' | 'none' | 'all'>();
  /** Android: how often to hyphenate. */
  readonly hyphenationFrequency = input<'normal' | 'none' | 'full'>(undefined, {
    alias: 'android_hyphenationFrequency',
  });
  /** Respond to presses. See the class note. */
  readonly pressable = input(false, { transform: booleanAttribute });
  /** iOS: do not grey the text while it is pressed. */
  readonly suppressHighlighting = input(false, { transform: booleanAttribute });

  /**
   * Written when the press starts and ends rather than bound from the host: a host binding would
   * run for every text on screen on every pass, to follow a press that almost none of them get.
   */
  protected override pressedChanged(pressed: boolean): void {
    const highlight = pressed && !this.suppressHighlighting();
    this.engine.setProp(this.node, 'isHighlighted', highlight ? true : undefined);
  }

  /** The pass-through props, written when one of them changes. See `ViewBase.ngOnChanges`. */
  override ngOnChanges(): void {
    super.ngOnChanges();
    const write = (key: string, value: unknown) => this.engine.setProp(this.node, key, value);
    write('numberOfLines', this.numberOfLines());
    write('ellipsizeMode', this.ellipsizeMode());
    write('selectable', this.selectable());
    write('selectionColor', this.selectionColor());
    write('allowFontScaling', this.allowFontScaling());
    write('maxFontSizeMultiplier', this.maxFontSizeMultiplier());
    write('dynamicTypeRamp', this.dynamicTypeRamp());
    write('adjustsFontSizeToFit', this.adjustsFontSizeToFit());
    write('minimumFontScale', this.minimumFontScale());
    write('lineBreakStrategyIOS', this.lineBreakStrategyIOS());
    write('textBreakStrategy', this.textBreakStrategy());
    write('dataDetectorType', this.dataDetectorType());
    write('android_hyphenationFrequency', this.hyphenationFrequency());
    write('isPressable', this.pressable() || undefined);
    // `disabled` is consumed as an input, so this is what `[data-disabled]` and `disabled:` match,
    // as on a control. Written here rather than bound from the host; see `pressedChanged`.
    write('data-disabled', this.disabled() ? '' : undefined);
  }

  protected override claims(): boolean {
    return this.pressable() && !this.disabled();
  }

  protected override measures(): boolean {
    return this.pressable();
  }
}
