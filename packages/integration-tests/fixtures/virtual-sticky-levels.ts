import { Component, signal, viewChild } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList, VirtualListRow } from '../../components/src/virtual-list.ts';
import { VirtualListNumColumns } from '../../components/src/virtual-list-num-columns.ts';
import { VirtualListStickyLevel } from '../../components/src/virtual-list-sticky-level.ts';

export interface Entry {
  readonly id: number;
  readonly label: string;
  /** 0 for a year, 1 for a month, 2 for a day, and null for what happened on one. */
  readonly level: number | null;
}

type LevelOf = (entry: Entry, index: number) => number | null | undefined;

/** A year's row is 50 along the list, a month's 40, a day's 30 and an entry 40. */
export const SIZES = [50, 40, 30];
export const ENTRY = 40;

/** Entries by day, days by month and months by year, with the row of each pinned over its own. */
@Component({
  selector: 'x-virtual-sticky-levels',
  imports: [VirtualList, VirtualListNumColumns, VirtualListStickyLevel, Text, View],
  template: `
    <virtual-list
      #list
      [items]="entries()"
      [itemHeight]="sizeOf"
      [overscan]="1"
      [windowSize]="1"
      [velocityLead]="0"
      [rowGap]="rowGap()"
      [horizontal]="horizontal()"
      [inverted]="inverted()"
      [stickyIndices]="sticky()"
      [stickyHeader]="stickyHeader()"
      [virtualListNumColumns]="columns()"
      [virtualListStickyLevel]="levelOf()"
      [virtualListMaxStickyLevels]="maxLevels()"
      [style]="fill"
    >
      <view listHeader nativeID="header"></view>
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style" [nativeID]="'row' + row.index"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualStickyLevels {
  readonly list = viewChild.required(VirtualList);
  readonly entries = signal<readonly Entry[]>(entries());
  readonly fill = { flex: 1 };
  readonly sizeOf = (entry: Entry) => SIZES[entry.level ?? -1] ?? ENTRY;
  readonly rowGap = signal(0);
  readonly horizontal = signal(false);
  readonly inverted = signal(false);
  readonly sticky = signal<readonly number[]>([]);
  readonly stickyHeader = signal(false);
  readonly columns = signal(1);
  readonly levelOf = signal<LevelOf | null | undefined>((entry) => entry.level);
  readonly maxLevels = signal<number | undefined>(undefined);
}

/** Rows that size themselves, which pin level 0 alone: the years, until a test gives more. */
@Component({
  selector: 'x-virtual-sticky-levels-measured',
  imports: [VirtualList, VirtualListRow, VirtualListStickyLevel, Text, View],
  template: `
    <virtual-list
      #list
      [items]="entries()"
      [estimatedItemHeight]="40"
      [overscan]="1"
      [virtualListStickyLevel]="levelOf()"
      [style]="fill"
    >
      @for (row of list.window(); track row.key) {
        <view [virtualListRow]="row" [nativeID]="'row' + row.index"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualStickyLevelsMeasured {
  readonly entries = signal<readonly Entry[]>(entries());
  readonly fill = { flex: 1 };
  readonly levelOf = signal<LevelOf>((entry) => (entry.level === 0 ? 0 : null));
}

/**
 * Three years of three months of three days of five entries: a day and its entries are 6 rows, a
 * month 19 and a year 58, so year `y` is row `58y`, its month `m` row `58y + 1 + 19m` and that
 * month's day `d` row `58y + 2 + 19m + 6d`.
 */
export function entries(): Entry[] {
  const out: Entry[] = [];
  const add = (label: string, level: number | null) => out.push({ id: out.length, label, level });
  for (let year = 0; year < 3; year++) {
    add(`year ${year}`, 0);
    for (let month = 0; month < 3; month++) {
      add(`month ${year}.${month}`, 1);
      for (let day = 0; day < 3; day++) {
        add(`day ${year}.${month}.${day}`, 2);
        for (let entry = 0; entry < 5; entry++) add(`entry ${out.length}`, null);
      }
    }
  }
  return out;
}
