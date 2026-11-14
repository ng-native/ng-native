/**
 * `<expo-glass>` and `<expo-glass-container>`: iOS 26's Liquid Glass, from `expo-glass-effect`,
 * typed so a template is checked against the props. Registered with
 * `registerExpoViews('expo-glass', 'expo-glass-container')`. Where Liquid Glass is unavailable -
 * before iOS 26, and on Android - the view renders as a plain view, so a fallback background is the
 * app's to set; `liquidGlassAvailable()` says which it will be. On macOS the desktop host draws
 * NSGlassEffectView from macOS 26, and a frosted NSVisualEffectView before it; a container is a
 * plain view there, each glass view drawing its own.
 *
 * ```html
 * <expo-glass-container spacing="10">
 *   <expo-glass class="size-16 rounded-full" glassEffectStyle="clear" isInteractive />
 *   <expo-glass class="size-16 rounded-full" tintColor="#0a84ff33" />
 * </expo-glass-container>
 * ```
 *
 * The corners are the element's own `border-radius`, which native reads from the same props.
 */
import { Component, input } from '@angular/core';
import { optionalBoolean, optionalNumber } from './transforms.ts';

export type GlassStyle = 'regular' | 'clear' | 'none';

/** A style, and whether a change to it animates. */
export interface GlassEffectStyleConfig {
  readonly style: GlassStyle;
  readonly animate?: boolean;
  /** Seconds. */
  readonly animationDuration?: number;
}

@Component({
  selector: 'expo-glass',
  template: '<ng-content />',
  host: {
    '[glassEffectStyle]': 'glassEffectStyle()',
    '[tintColor]': 'tintColor()',
    '[isInteractive]': 'isInteractive()',
    '[colorScheme]': 'colorScheme()',
  },
})
export class ExpoGlass {
  /** `regular` by default; `clear` is more transparent; `none` turns the effect off. */
  readonly glassEffectStyle = input<GlassStyle | GlassEffectStyleConfig>();
  /** A colour the glass is tinted with, usually translucent. */
  readonly tintColor = input<string>();
  /** Reacts to touch, as a control made of glass does. */
  readonly isInteractive = input<boolean>(undefined, { transform: optionalBoolean });
  /** The appearance the glass takes, when it should not follow the app's. */
  readonly colorScheme = input<'auto' | 'light' | 'dark'>();
}

/** Glass views that merge into one another when they come within `spacing` points. */
@Component({
  selector: 'expo-glass-container',
  template: '<ng-content />',
  host: { '[spacing]': 'spacing()' },
})
export class ExpoGlassContainer {
  readonly spacing = input<number>(undefined, { transform: optionalNumber });
}

/**
 * Whether the app renders with Liquid Glass: iOS 26 and later, with `expo-glass-effect`
 * installed. The user can still reduce transparency in the accessibility settings, which the
 * platform then honours on its own.
 */
export function liquidGlassAvailable(): boolean {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  const glass = modules?.['ExpoGlassEffect'] as { isLiquidGlassAvailable?: unknown } | undefined;
  return glass?.isLiquidGlassAvailable === true;
}
