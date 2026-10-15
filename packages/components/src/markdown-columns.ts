/**
 * The columns of a Markdown table, each as wide as its widest cell.
 *
 * Yoga has no table layout, so a table is rows of cells, and a cell is as wide as its own text.
 * Each cell's text reports its width with `(layout)`; the widest in a column becomes the least
 * width of every cell in it, which lines the column up. The text is measured inside that least
 * width rather than at it, so a cell that narrows, or a row or column that goes, narrows its
 * column again.
 */
import { Directive, input, linkedSignal } from '@angular/core';
import type { LayoutEvent } from './events.ts';
import type { MarkdownBlock } from './markdown-blocks.ts';

type MarkdownTable = Extract<MarkdownBlock, { kind: 'table' }>;

interface Columns {
  /** Each cell's text width, by column and then row, with the header as row 0. */
  readonly cells: number[][];
  /** Each column's widest cell. */
  readonly widths: readonly number[];
}

const widest = (column: readonly number[]): number =>
  column.reduce((most, width) => Math.max(most, width), 0);

@Directive({ selector: '[markdownColumns]', exportAs: 'markdownColumns' })
export class MarkdownColumns {
  /** The table whose columns are lined up. */
  readonly table = input.required<MarkdownTable>({ alias: 'markdownColumns' });

  /**
   * The measured cells and each column's widest. A new table keeps only the cells of the rows
   * and columns it still has, so one that goes and comes back starts unmeasured.
   */
  private readonly columns = linkedSignal<MarkdownTable, Columns>({
    source: this.table,
    computation: ({ header, rows }, previous) => {
      const cells = header.map((_, column) =>
        (previous?.value.cells[column] ?? []).slice(0, rows.length + 1),
      );
      return { cells, widths: cells.map(widest) };
    },
  });

  /** The least width of a cell in `column`, or null until one of its cells is measured. */
  width(column: number): number | null {
    return this.columns().widths[column] || null;
  }

  /**
   * Records the width the text of the cell at `row` (0 for the header) and `column` was laid out
   * at. Only a column whose widest cell narrows is gone over again.
   */
  measure(row: number, column: number, event: Partial<LayoutEvent>): void {
    const width = event.nativeEvent?.layout.width;
    if (width === undefined || row > this.table().rows.length) return;
    const { cells, widths } = this.columns();
    const measured = cells[column];
    if (!measured || measured[row] === width) return;
    const was = measured[row];
    measured[row] = width;
    const most = widths[column]!;
    const next = width >= most ? width : was === most ? widest(measured) : most;
    if (next === most) return;
    const changed = [...widths];
    changed[column] = next;
    this.columns.set({ cells, widths: changed });
  }
}
