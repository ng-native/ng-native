/**
 * The columns of a Markdown table, each as wide as its widest cell.
 *
 * Yoga has no table layout, so a table is rows of cells, and a cell is as wide as its own text.
 * Each cell's text reports its width with `(layout)`; the widest in a column becomes the least
 * width of every cell in it, which lines the column up. The text is measured inside that least
 * width rather than at it, so a cell that narrows, or a row or column that goes, narrows its
 * column again.
 */
import { Directive, computed, input, signal } from '@angular/core';
import type { LayoutEvent } from './events.ts';
import type { MarkdownBlock } from './markdown-blocks.ts';

type MarkdownTable = Extract<MarkdownBlock, { kind: 'table' }>;

@Directive({ selector: '[markdownColumns]', exportAs: 'markdownColumns' })
export class MarkdownColumns {
  /** The table whose columns are lined up. */
  readonly table = input.required<MarkdownTable>({ alias: 'markdownColumns' });

  /** Each cell's text width, by `row:column`, with the header as row 0. */
  private readonly measured = signal<ReadonlyMap<string, number>>(new Map());

  /** Each column's widest cell, counting only the rows and columns the table still has. */
  private readonly widths = computed(() => {
    const { header, rows } = this.table();
    const widths = header.map(() => 0);
    for (const [key, width] of this.measured()) {
      const [row, column] = key.split(':').map(Number) as [number, number];
      if (row <= rows.length && column < widths.length) {
        widths[column] = Math.max(widths[column]!, width);
      }
    }
    return widths;
  });

  /** The least width of a cell in `column`, or null until one of its cells is measured. */
  width(column: number): number | null {
    return this.widths()[column] || null;
  }

  /** Records the width the text of the cell at `row` (0 for the header) and `column` was laid out at. */
  measure(row: number, column: number, event: Partial<LayoutEvent>): void {
    const width = event.nativeEvent?.layout.width;
    if (width === undefined) return;
    const key = `${row}:${column}`;
    if (this.measured().get(key) === width) return;
    this.measured.update((measured) => new Map(measured).set(key, width));
  }
}
