import { Component, computed, forwardRef, input } from '@angular/core';
import { isApplePlatform, registerViewName, type HostNode } from '@ng-native/fabric';
import type { ControlSize } from '@ng-native/device';
import { ControlBase, TouchableBase } from './pressable.ts';

/** What a button does in its window: Return presses `default`, Escape presses `cancel`. */
export type ButtonKind = 'default' | 'cancel' | 'destructive' | 'plain';

/** A button's picture, as on `<native-tab>`: an SF Symbol on Apple's OSes, a drawable on Android. */
export type ButtonIcon = { readonly sfSymbol: string } | { readonly drawable: string };

/**
 * The button on Apple's OSes is the host's: NSButton on macOS and UIButton on iOS. Android has no
 * platform button React Native draws, so there it is a view this component makes pressable.
 */
registerViewName(
  'native-button',
  { ios: 'NgNativeButton', android: 'View', macos: 'NgNativeButton' },
  undefined,
  { textContent: 'title' },
);

/**
 * A platform button, its label the text inside it:
 *
 *   <native-button kind="default" (press)="save()">Save</native-button>
 *
 * On macOS it is an NSButton and on iOS a UIButton, drawn by the host, which sends
 * `topButtonPress` when it is clicked, tapped, or pressed by Return (a `default` button), Escape
 * (a `cancel` one) or Space. On Android it is a view pressed through the responder, as a
 * `<pressable>` is, and takes `android_ripple` as one does. The web host draws an HTML `button`.
 * It is a button to assistive technology everywhere, and takes focus.
 */
@Component({
  selector: 'native-button',
  template: '<ng-content />',
  providers: [{ provide: TouchableBase, useExisting: forwardRef(() => NativeButton) }],
  host: {
    '[kind]': 'kind()',
    '[controlSize]': 'controlSize()',
    '[sfSymbol]': 'symbol()',
    '[drawable]': 'drawableResource()',
    '[enabled]': '!pressDisabled()',
  },
})
export class NativeButton extends ControlBase {
  /**
   * What the button does in its window. `default` takes Return and `cancel` takes Escape. Unset,
   * it is a plain push button that takes neither.
   */
  readonly kind = input<ButtonKind>();
  /** AppKit's control size on macOS, and UIKit's button size on iOS. Ignored elsewhere. */
  readonly controlSize = input<ControlSize>();
  /** An SF Symbol beside the label, on iOS and macOS. */
  readonly sfSymbol = input<string>();
  /** Android: a drawable resource beside the label. */
  readonly drawableName = input<string>(undefined, { alias: 'drawable' });
  /** The picture for each OS at once, as on `<native-tab>`. */
  readonly icon = input<ButtonIcon>();

  protected readonly symbol = computed(() => {
    const icon = this.icon();
    return this.sfSymbol() ?? (icon && 'sfSymbol' in icon ? icon.sfSymbol : undefined);
  });

  protected readonly drawableResource = computed(() => {
    const icon = this.icon();
    return this.drawableName() ?? (icon && 'drawable' in icon ? icon.drawable : undefined);
  });

  /** Where the host draws the button, it presses it: the responder would press it twice. */
  private readonly drawnByHost = isApplePlatform();
  private stopPress: (() => void) | null = null;

  protected override roleByDefault(): 'button' {
    return 'button';
  }

  protected override accessibleByDefault(): boolean {
    return true;
  }

  protected override focusableByDefault(): boolean {
    return true;
  }

  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }

  protected override claims(): boolean {
    return !this.drawnByHost && super.claims();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    if (!this.drawnByHost || this.stopPress) return;
    this.stopPress = this.engine.setEventListener(
      this.node as HostNode,
      'topButtonPress',
      (event) => {
        if (!this.pressDisabled()) this.press.emit(event as never);
      },
    );
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.stopPress?.();
  }
}
