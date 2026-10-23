/**
 * `<expo-symbol>`: an SF Symbol, from `expo-symbols`, typed so a template is checked against the
 * props. iOS only. Registered with `registerExpoViews('expo-symbol')`.
 *
 * It does what the module's React component does before native sees the props: `type` is
 * `monochrome` unless set, one colour or several become the list native takes, and an
 * `animationSpec` is what turns animation on.
 *
 * `size` is a point size, as SwiftUI's `.font(.system(size:))` takes it (24 unless set): the view
 * is the size of the symbol's image at that point size, weight and scale, which this package's
 * native module reports, and the symbol fills it. Without that module, as in Expo Go, the view is
 * `size` points square, as the React component makes it, and the symbol is fitted into it, which
 * draws most symbols smaller than SwiftUI does.
 *
 * ```html
 * <expo-symbol name="heart.fill" [size]="28" tintColor="#ff2d55" weight="semibold" />
 * <expo-symbol name="cloud.sun.fill" type="palette" [colors]="['#fff', '#ffcc00']" />
 * ```
 */
import { Component, computed, input } from '@angular/core';
import { optionalNumber } from './transforms.ts';

export type SymbolType = 'monochrome' | 'hierarchical' | 'palette' | 'multicolor';
export type SymbolScale = 'default' | 'unspecified' | 'small' | 'medium' | 'large';
export type SymbolWeight =
  | 'unspecified'
  | 'ultraLight'
  | 'thin'
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'heavy'
  | 'black';
export type SymbolResizeMode =
  | 'scaleToFill'
  | 'scaleAspectFit'
  | 'scaleAspectFill'
  | 'redraw'
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

/** How a symbol animates, as `expo-symbols` describes it. */
export interface SymbolAnimationSpec {
  readonly effect?: {
    readonly type: 'bounce' | 'pulse' | 'scale';
    readonly wholeSymbol?: boolean;
    readonly direction?: 'up' | 'down';
  };
  readonly repeating?: boolean;
  readonly repeatCount?: number;
  readonly speed?: number;
  readonly variableAnimationSpec?: Readonly<Record<string, boolean>>;
}

@Component({
  selector: 'expo-symbol',
  template: '',
  host: {
    '[name]': 'name()',
    '[type]': 'type()',
    '[scale]': 'scale()',
    '[weight]': 'weight()',
    '[tintColor]': 'tintColor()',
    '[colors]': 'colourList()',
    '[resizeMode]': 'resizeMode()',
    '[animationSpec]': 'animationSpec()',
    '[animated]': 'animated()',
    '[style.width]': 'box()[0]',
    '[style.height]': 'box()[1]',
  },
})
export class ExpoSymbol {
  /** The symbol's name, as SF Symbols lists it: `heart.fill`, `cloud.sun.rain`. */
  readonly name = input.required<string>();
  readonly type = input<SymbolType>('monochrome');
  readonly scale = input<SymbolScale>();
  readonly weight = input<SymbolWeight>();
  /** The colour of a `monochrome` or `hierarchical` symbol. */
  readonly tintColor = input<string>();
  /** The layers' colours, for `palette`. */
  readonly colors = input<string | readonly string[]>();
  readonly resizeMode = input<SymbolResizeMode>();
  readonly animationSpec = input<SymbolAnimationSpec>();
  /** The point size the symbol is drawn at. */
  readonly size = input(24, { transform: (value: unknown) => optionalNumber(value) ?? 24 });

  protected readonly colourList = computed(() => {
    const colours = this.colors();
    return colours === undefined ? undefined : typeof colours === 'string' ? [colours] : colours;
  });
  protected readonly animated = computed(() => this.animationSpec() !== undefined);
  /** Width and height: the symbol image's at the point size, or the square without native's. */
  protected readonly box = computed(() => {
    const size = this.size();
    return symbolImageSize(this.name(), size, this.weight(), this.scale()) ?? [size, size];
  });
}

/** This package's native symbol module, iOS only and absent from Expo Go. */
interface NativeSymbol {
  imageSize?(
    name: string,
    pointSize: number,
    weight?: SymbolWeight,
    scale?: SymbolScale,
  ): readonly number[] | null;
}

/** The size of the symbol's image in points, or null where native cannot say. */
function symbolImageSize(
  name: string,
  pointSize: number,
  weight: SymbolWeight | undefined,
  scale: SymbolScale | undefined,
): readonly [number, number] | null {
  const native = (globalThis as { expo?: { modules?: { NgNativeSymbol?: NativeSymbol } } }).expo
    ?.modules?.NgNativeSymbol;
  const size = native?.imageSize?.(name, pointSize, weight, scale);
  return size ? [size[0]!, size[1]!] : null;
}
