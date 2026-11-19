import { Directive, Injector, computed, effect, forwardRef, inject, input } from '@angular/core';
import { numberOr } from './transforms.ts';
import { VirtualList } from './virtual-list.ts';
import { VIRTUAL_LIST_LAYOUT, type VirtualListLayout } from './virtual-list-layout.ts';

/**
 * FlatList's `numColumns`, on `<virtual-list>` itself: a photo grid or a shop's products, windowed
 * a line at a time.
 *
 * ```html
 * <virtual-list #list [items]="photos" [itemHeight]="120" [rowGap]="2"
 *               [virtualListNumColumns]="3" [virtualListColumnGap]="2">
 *   @for (row of list.window(); track row.slot) {
 *     <image [virtualListRow]="row" [source]="row.item.uri" />
 *   }
 * </virtual-list>
 * ```
 *
 * Each item is still one row of the window, with its own slot, key and recycling, so the `@for`
 * is the same as a plain list's. Items fill a line left to right, right to left in a
 * right-to-left layout, and every column is the same width. A line is as tall as its tallest item,
 * and its items stretch to it, as they do in FlatList's row. A sticky row takes a line to itself,
 * so a month's header pins across the whole grid.
 *
 * Columns are for vertical lists with `itemHeight`, as FlatList's `numColumns` is vertical only.
 *
 * ponytail: rows that size themselves stay one to a line, with a warning in development, since a
 * line's height would wait on every item in it measuring. FlatList's `columnWrapperStyle` has no
 * equivalent: there is no view per line to style. A separator is drawn under each item.
 */
@Directive({
  selector: 'virtual-list[virtualListNumColumns]',
  providers: [
    { provide: VIRTUAL_LIST_LAYOUT, useExisting: forwardRef(() => VirtualListNumColumns) },
  ],
})
export class VirtualListNumColumns implements VirtualListLayout {
  /** Items to a line, as FlatList's `numColumns`. */
  readonly numColumns = input(1, { alias: 'virtualListNumColumns', transform: numberOr(1) });
  /** Space between one column and the next. `rowGap` on the list spaces the lines. */
  readonly columnGap = input(0, { alias: 'virtualListColumnGap', transform: numberOr(0) });

  // Looked up once the list exists: the list injects this directive while it is being made.
  private readonly injector = inject(Injector);

  readonly columns = computed(() => {
    const columns = this.numColumns();
    return Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  });

  constructor() {
    if (typeof ngDevMode === 'undefined' || !ngDevMode) return;
    const unsupported = effect(() => {
      if (this.columns() === 1) return;
      const list = this.injector.get(VirtualList, null, { self: true });
      const why = list?.horizontal()
        ? 'a horizontal list'
        : list?.measuring()
          ? 'rows without itemHeight'
          : null;
      if (!why) return;
      unsupported.destroy();
      console.warn(
        `[angular-native] virtualListNumColumns lays out one item a line on ${why}: columns ` +
          `are for a vertical list with itemHeight, as FlatList's numColumns is vertical only.`,
      );
    });
  }

  /**
   * Each column is an equal share of the width, as a percentage, so the line needs no width to
   * be laid out and follows a rotation without one. The padding and gaps are then taken out by
   * margins: every column gives up the same amount, and how much of it is on which side is what
   * puts the gaps between the columns rather than inside them.
   */
  across(column: number, left: number, right: number): Record<string, unknown> {
    const columns = this.columns();
    const gap = this.columnGap();
    const spare = (left + right + (columns - 1) * gap) / columns;
    const marginStart = left - (column * (left + right - gap)) / columns;
    return {
      start: `${(column * 100) / columns}%`,
      end: `${((columns - 1 - column) * 100) / columns}%`,
      marginStart,
      marginEnd: spare - marginStart,
    };
  }
}

declare const ngDevMode: unknown;
