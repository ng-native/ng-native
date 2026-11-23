import { Directive, Injector, computed, effect, forwardRef, inject, input } from '@angular/core';
import { numberOr } from './transforms.ts';
import { VirtualList } from './virtual-list.ts';
import { VIRTUAL_LIST_STICKY, type VirtualListSticky } from './virtual-list-sticky.ts';

/**
 * Sticky rows at more than one level, on `<virtual-list>` itself: a year pinned at the leading
 * edge, its month under it and the day under that, each pushed off by the next of its own level
 * or of one further out.
 *
 * ```html
 * <virtual-list #list [items]="rows" [itemHeight]="44" [virtualListStickyLevel]="levelOf">
 *   @for (row of list.window(); track row.slot) {
 *     <view [virtualListRow]="row"><text>{{ row.item.label }}</text></view>
 *   }
 * </virtual-list>
 * ```
 *
 * `levelOf` is given each item and its index and returns the row's level: 0 for the outermost,
 * 1 for the rows pinned under those, and so on, or `null` for a row that scrolls with the rest.
 * A row pins under the nearest row before it of each level further out than its own, and stays
 * until the next row of its own level, or of one further out, pushes it off. The rows of
 * `stickyIndices` are at level 0, so the two can be given together.
 *
 * ponytail: rows that size themselves pin level 0 alone, with a warning in development, and
 * deeper rows scroll with the rest: where a row pins under others depends on their heights, which
 * are not known until each has been measured.
 */
@Directive({
  selector: 'virtual-list[virtualListStickyLevel]',
  providers: [
    { provide: VIRTUAL_LIST_STICKY, useExisting: forwardRef(() => VirtualListStickyLevel) },
  ],
})
export class VirtualListStickyLevel<T = unknown> implements VirtualListSticky {
  /** A row's level, from 0 for the outermost, or `null` for a row that is not sticky. */
  readonly level = input<
    ((item: T, index: number) => number | null | undefined) | null | undefined
  >(undefined, { alias: 'virtualListStickyLevel' });
  /**
   * How many levels pin at once, from the outermost. Rows deeper than that are not sticky. It
   * limits the levels the function gives: the rows of `stickyIndices` pin whatever it is.
   */
  readonly maxLevels = input(Infinity, {
    alias: 'virtualListMaxStickyLevels',
    transform: numberOr(Infinity),
  });

  // Looked up once the list exists: the list injects this directive while it is being made.
  private readonly injector = inject(Injector);

  readonly levelOf = computed(() => {
    const level = this.level();
    if (!level) return null;
    const levels = this.maxLevels();
    return (item: unknown, index: number) => {
      const at = level(item as T, index);
      return typeof at === 'number' && at >= 0 && at < levels ? Math.floor(at) : null;
    };
  });

  constructor() {
    if (typeof ngDevMode === 'undefined' || !ngDevMode) return;
    const unsupported = effect(() => {
      const levelOf = this.levelOf();
      const list = this.injector.get(VirtualList, null, { self: true });
      if (!levelOf || !list?.measuring()) return;
      if (!list.items().some((item, index) => (levelOf(item, index) ?? 0) > 0)) return;
      unsupported.destroy();
      console.warn(
        `[angular-native] virtualListStickyLevel pins level 0 alone on rows without itemHeight: ` +
          `a row pins under others by their heights, which rows that size themselves do not ` +
          `have until they are measured.`,
      );
    });
  }
}

declare const ngDevMode: unknown;
