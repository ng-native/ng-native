/**
 * `<expo-mesh-gradient>`, typed: `expo-mesh-gradient`'s view, registered with
 * `registerExpoViews('expo-mesh-gradient')`, with its props as inputs so a template is checked
 * against them. Each goes straight to the view. The engine converts `colors` at commit, as it
 * does any `colors` list, which is what `expo-mesh-gradient`'s React component does with
 * `processColor`.
 *
 * ```html
 * <expo-mesh-gradient
 *   class="flex-1"
 *   columns="2"
 *   rows="2"
 *   [points]="[[0, 0], [1, 0], [0, 1], [1, 1]]"
 *   [colors]="['red', 'purple', 'blue', 'orange']"
 * />
 * ```
 *
 * Children are for `mask`, on iOS. `expo-mesh-gradient`'s React component passes the view none
 * on Android, so give it none there.
 */
import { Component, input } from '@angular/core';
import { optionalBoolean, optionalNumber } from './transforms.ts';

@Component({
  selector: 'expo-mesh-gradient',
  template: '<ng-content />',
  host: {
    '[columns]': 'columns()',
    '[rows]': 'rows()',
    '[points]': 'points()',
    '[colors]': 'colors()',
    '[smoothsColors]': 'smoothsColors()',
    '[ignoresSafeArea]': 'ignoresSafeArea()',
    '[mask]': 'mask()',
    '[resolution]': 'resolution()',
  },
})
export class ExpoMeshGradient {
  /** The number of points in each row. */
  readonly columns = input<number>(undefined, { transform: optionalNumber });
  /** The number of points in each column. */
  readonly rows = input<number>(undefined, { transform: optionalNumber });
  /** `columns * rows` points, each `[x, y]` from 0 to 1. */
  readonly points = input<readonly (readonly number[])[]>();
  /** `columns * rows` colours, one for each point. */
  readonly colors = input<readonly string[]>();
  /** Interpolates the colours smoothly too, not only the shape. True unless set. */
  readonly smoothsColors = input<boolean>(undefined, { transform: optionalBoolean });
  /** Draws under the safe areas. True unless set. iOS only. */
  readonly ignoresSafeArea = input<boolean>(undefined, { transform: optionalBoolean });
  /**
   * Draws the gradient only where the children are opaque, and takes no touches for them. A bare
   * attribute is true. iOS only.
   */
  readonly mask = input<boolean>(undefined, { transform: optionalBoolean });
  /** How many points Android samples between two of the mesh's. Android only. */
  readonly resolution = input<{ readonly x?: number; readonly y?: number }>();
}
