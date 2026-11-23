import { Component, afterEveryRender, signal, viewChild } from '@angular/core';
import {
  Pressable,
  Text,
  View,
  VirtualList,
  VirtualListRow,
  VirtualListStickyLevel,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';

type Kind = 'year' | 'month' | 'day' | 'event';

interface Row {
  readonly kind: Kind;
  readonly id: string;
  readonly label: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EVENTS = ['Stand-up', 'Design review', 'Lunch', 'Pairing', 'Release notes', 'Retro'];
const LEVELS: Record<Kind, number | null> = { year: 0, month: 1, day: 2, event: null };
const HEIGHTS: Record<Kind, number> = { year: 44, month: 36, day: 30, event: 48 };

/**
 * Three years of an agenda: each day's events under the day, the days under their month and the
 * months under their year, with the year, the month and the day pinned one under the other while
 * the events scroll under them.
 */
@Component({
  selector: 'x-sticky-levels',
  imports: [
    NativeHeader,
    Pressable,
    Text,
    View,
    VirtualList,
    VirtualListRow,
    VirtualListStickyLevel,
  ],
  template: `
    <native-header title="Sticky levels" />
    <view class="screen grow">
      <view class="bar">
        @for (count of counts; track count) {
          <pressable
            class="chip"
            [class.current]="count === levels()"
            accessibilityRole="button"
            [accessibilityLabel]="'Pin ' + count + (count === 1 ? ' level' : ' levels')"
            (press)="levels.set(count)"
          >
            <text class="chip-label" [class.current-label]="count === levels()"
              >{{ count }} {{ count === 1 ? 'level' : 'levels' }}</text
            >
          </pressable>
        }
      </view>
      <virtual-list
        #list
        class="grow"
        [items]="rows"
        [itemHeight]="heightOf"
        [itemType]="kindOf"
        [keyExtractor]="keyOf"
        [virtualListStickyLevel]="levelOf"
        [virtualListMaxStickyLevels]="levels()"
      >
        @for (row of list.window(); track row.slot) {
          <view [virtualListRow]="row">
            <view [class]="'row ' + row.item.kind"
              ><text [class]="'label ' + row.item.kind + '-label'">{{ row.item.label }}</text></view
            >
          </view>
        }
      </virtual-list>
      <text class="hint mounted">
        mounted <text class="strong">{{ mounted() }}</text> of {{ rows.length }}
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
    .row {
      flex: 1;
      justify-content: center;
      padding: 0 12px;
    }
    .year {
      background-color: var(--accent);
    }
    .month {
      padding-left: 20px;
      background-color: var(--card);
    }
    .day {
      padding-left: 28px;
      background-color: var(--card-inset);
    }
    .event {
      padding-left: 36px;
    }
    .label {
      color: var(--text-strong);
      font-size: 15px;
    }
    .year-label {
      color: white;
      font-size: 17px;
      font-weight: 700;
    }
    .month-label {
      color: var(--text-strong);
      font-weight: 700;
    }
    .day-label {
      color: var(--text-strong);
      font-size: 13px;
      font-weight: 600;
    }
  `,
})
export class StickyLevelsPage {
  protected readonly counts = [1, 2, 3];
  /** How many levels pin: the year alone, the year and the month, or the day under them too. */
  protected readonly levels = signal(3);
  /** The rows mounted, which stays a screen's worth however far the list scrolls. */
  protected readonly mounted = signal(0);
  private readonly list = viewChild(VirtualList);

  constructor() {
    // Read after the list renders, once its inputs are set.
    afterEveryRender(() => this.mounted.set(this.list()?.window().length ?? 0));
  }

  protected readonly rows: readonly Row[] = agenda(2024, 3);
  protected readonly keyOf = (row: Row) => row.id;
  protected readonly kindOf = (row: Row) => row.kind;
  protected readonly heightOf = (row: Row) => HEIGHTS[row.kind];
  protected readonly levelOf = (row: Row) => LEVELS[row.kind];
}

/** Every day of `years` years from `from`, each with two to four events. */
function agenda(from: number, years: number): Row[] {
  const rows: Row[] = [];
  for (let year = from; year < from + years; year++) {
    rows.push({ kind: 'year', id: `${year}`, label: `${year}` });
    MONTHS.forEach((month, m) => {
      rows.push({ kind: 'month', id: `${year}-${m}`, label: `${month} ${year}` });
      const days = new Date(year, m + 1, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const weekday = WEEKDAYS[new Date(year, m, day).getDay()]!;
        rows.push({ kind: 'day', id: `${year}-${m}-${day}`, label: `${weekday} ${day} ${month}` });
        for (let event = 0; event < 2 + ((day + m) % 3); event++) {
          rows.push({
            kind: 'event',
            id: `${year}-${m}-${day}-${event}`,
            label: EVENTS[(day + m + event) % EVENTS.length]!,
          });
        }
      }
    });
  }
  return rows;
}
