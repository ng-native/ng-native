import { Directive, input } from '@angular/core';
import { registerViewName } from '@ng-native/fabric';
import { hostDraws } from './split-view.ts';
import { optionalBoolean } from './transforms.ts';
import { ViewBase } from './view-base.ts';

/**
 * On macOS an NSVisualEffectView behind the element's children, drawn by the desktop host. On
 * Linux, iOS and Android a plain view, whose own background shows.
 */
registerViewName('visual-effect', {
  ios: 'View',
  android: 'View',
  macos: 'NgNativeVisualEffect',
});

/** One of AppKit's materials, by the name of its `NSVisualEffectMaterial` case. */
export type VisualEffectMaterial =
  | 'sidebar'
  | 'window-background'
  | 'under-window-background'
  | 'content-background'
  | 'under-page-background'
  | 'header-view'
  | 'titlebar'
  | 'menu'
  | 'popover'
  | 'sheet'
  | 'hud-window'
  | 'full-screen-ui'
  | 'tooltip'
  | 'selection';

/** What the material blurs: the desktop and windows behind the window, or the window's own content. */
export type VisualEffectBlendingMode = 'behind-window' | 'within-window';

/** Whether the material looks active: as its window does, always, or never. */
export type VisualEffectState = 'follows-window' | 'active' | 'inactive';

/**
 * A view in one of the system's translucent materials, behind its children:
 *
 *   <visual-effect class="backdrop" material="sidebar">...</visual-effect>
 *
 * With `behind-window` blending, the default, macOS draws what is behind the window through it,
 * blurred and tinted, as a source list's sidebar does, and with `within-window` the window's own
 * content under it. It lays out and takes styles as a `<view>` does, and its `border-radius`
 * rounds the material. Elsewhere it is a plain view: give it a `background-color` for Linux, iOS
 * and Android.
 */
@Directive({
  selector: 'visual-effect',
  host: {
    '[material]': 'drawn ? (material() ?? null) : undefined',
    '[blendingMode]': 'drawn ? (blendingMode() ?? null) : undefined',
    '[state]': 'drawn ? (state() ?? null) : undefined',
    '[emphasized]': 'drawn ? (emphasized() ?? null) : undefined',
  },
})
export class VisualEffect extends ViewBase {
  /**
   * Whether the desktop host draws the material here, rather than a plain view. Where it does, an
   * input left unset commits `null`, so one taken away goes back to the host's default rather than
   * keeping the value it had; elsewhere none of them is committed.
   */
  protected readonly drawn = hostDraws('visual-effect');

  /** The material. Defaults to `sidebar`. */
  readonly material = input<VisualEffectMaterial>();
  /** What the material blurs. Defaults to `behind-window`. */
  readonly blendingMode = input<VisualEffectBlendingMode>();
  /** Whether it looks active. Defaults to `follows-window`. */
  readonly state = input<VisualEffectState>();
  /** A selection material drawn in the accent colour, as a source list's focused selection is. */
  readonly emphasized = input(undefined, { transform: optionalBoolean });
}
