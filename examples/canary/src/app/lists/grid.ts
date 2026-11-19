import { Component, afterEveryRender, computed, signal, viewChild } from '@angular/core';
import {
  Pressable,
  Text,
  View,
  VirtualList,
  VirtualListNumColumns,
  VirtualListRow,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';

type Cell =
  | { readonly kind: 'month'; readonly id: string; readonly label: string }
  | { readonly kind: 'tile'; readonly id: string; readonly label: string; readonly color: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August'];
const MONTH = 36;
/** A tile's height for each column count, so tiles stay roughly square on a phone. */
const TILE: Record<number, number> = { 2: 170, 3: 112, 4: 84 };

/**
 * A photo library's grid: 5,000 tiles under month headers, windowed a line at a time, with each
 * month pinned across the whole grid while its tiles scroll under it.
 */
@Component({
  selector: 'x-grid',
  imports: [
    NativeHeader,
    Pressable,
    Text,
    View,
    VirtualList,
    VirtualListNumColumns,
    VirtualListRow,
  ],
  template: `
    <native-header title="Virtual grid" />
    <view class="screen grow">
      <view class="bar">
        @for (count of counts; track count) {
          <pressable
            class="chip"
            [class.current]="count === columns()"
            accessibilityRole="button"
            [accessibilityLabel]="count + ' columns'"
            (press)="columns.set(count)"
          >
            <text class="chip-label" [class.current-label]="count === columns()"
              >{{ count }} columns</text
            >
          </pressable>
        }
      </view>
      <virtual-list
        #list
        class="grow"
        [items]="cells"
        [itemHeight]="heightOf()"
        [keyExtractor]="keyOf"
        [stickyIndices]="months"
        [rowGap]="2"
        [virtualListNumColumns]="columns()"
        [virtualListColumnGap]="2"
      >
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            @if (row.item.kind === 'month') {
              <view class="month"
                ><text class="month-label">{{ row.item.label }}</text></view
              >
            } @else {
              <view class="tile" [style.backgroundColor]="row.item.color"
                ><text class="tile-label">{{ row.item.label }}</text></view
              >
            }
          </view>
        }
      </virtual-list>
      <text class="hint mounted">
        mounted <text class="strong">{{ mounted() }}</text> of {{ cells.length }}
      </text>
    </view>
  `,
  styles: `
    .grow {
      flex: 1;
    }
    .bar {
      flex-direction: row;
      gap: 8px;
      padding: 8px 12px;
    }
    .chip {
      padding: 6px 12px;
      border-radius: 14px;
      background-color: var(--card);
    }
    .current {
      background-color: var(--accent);
    }
    .chip-label {
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
    }
    .current-label {
      color: white;
    }
    .mounted {
      padding: 8px 12px;
    }
    .month {
      flex: 1;
      justify-content: center;
      padding: 0 12px;
      background-color: var(--card);
    }
    .month-label {
      color: var(--text-strong);
      font-size: 15px;
      font-weight: 700;
    }
    .tile {
      flex: 1;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 6px;
    }
    .tile-label {
      color: white;
      font-size: 12px;
      font-weight: 600;
    }
  `,
})
export class GridPage {
  protected readonly counts = [2, 3, 4];
  protected readonly columns = signal(3);
  /** The tiles and headers mounted, which stays a screen's worth however far the grid scrolls. */
  protected readonly mounted = signal(0);
  private readonly list = viewChild(VirtualList);

  constructor() {
    // Read after the list renders, once its inputs are set.
    afterEveryRender(() => this.mounted.set(this.list()?.window().length ?? 0));
  }

  protected readonly cells: readonly Cell[] = cells(5000);
  protected readonly months = this.cells.flatMap((cell, index) =>
    cell.kind === 'month' ? [index] : [],
  );
  protected readonly keyOf = (cell: Cell) => cell.id;
  protected readonly heightOf = computed(() => {
    const tile = TILE[this.columns()] ?? TILE[3]!;
    return (cell: Cell) => (cell.kind === 'month' ? MONTH : tile);
  });
}

/** `count` tiles, spread over the months, each a colour of its own. */
function cells(count: number): Cell[] {
  const perMonth = Math.ceil(count / MONTHS.length);
  return MONTHS.flatMap((month, m) => [
    { kind: 'month' as const, id: `m${m}`, label: `${month} 2026` },
    ...Array.from({ length: Math.min(perMonth, count - m * perMonth) }, (_, i) => {
      const n = m * perMonth + i;
      return {
        kind: 'tile' as const,
        id: `t${n}`,
        label: `${n + 1}`,
        color: `hsl(${(n * 37) % 360}, 55%, 55%)`,
      };
    }),
  ]);
}
