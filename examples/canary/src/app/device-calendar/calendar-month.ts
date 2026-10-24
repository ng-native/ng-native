import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import {
  addMonths,
  colorsByDay,
  dateOf,
  dayOf,
  isOn,
  monthGrid,
  sameMonth,
  weekDates,
  type CalendarDate,
  type CalendarEntry,
  type WeekStart,
} from './calendar-dates.ts';
import { Pressable, Text, View } from '@ng-native/components';

/**
 * A month as a grid of days: the month's name with arrows to the one before and after, the
 * weekdays, and a dot under each day for each colour of entry on it. A press selects a day.
 *
 * ```html
 * <calendar-month [(selected)]="day" [entries]="entries()" />
 * ```
 *
 * `selected` is two-way, and the grid shows the month it is in until an arrow moves it on. Each move
 * says which month is showing with `(monthChange)`, for loading that month's events. The names come
 * from `Intl`, in `locale` or the device's own.
 */
@Component({
  selector: 'calendar-month',
  imports: [Pressable, Text, View],
  template: `
    <view class="cal-month-head">
      <pressable
        class="cal-step"
        accessibilityRole="button"
        [accessibilityLabel]="previousLabel()"
        (press)="step(-1)"
      >
        <text class="cal-step-glyph">‹</text>
      </pressable>
      <text class="cal-month-name" accessibilityRole="header">{{ title() }}</text>
      <pressable
        class="cal-step"
        accessibilityRole="button"
        [accessibilityLabel]="nextLabel()"
        (press)="step(1)"
      >
        <text class="cal-step-glyph">›</text>
      </pressable>
    </view>
    <view class="cal-weekdays" [importantForAccessibility]="'no-hide-descendants'">
      @for (name of weekdays(); track $index) {
        <text class="cal-weekday">{{ name }}</text>
      }
    </view>
    @for (week of weeks(); track week[0]) {
      <view class="cal-week">
        @for (day of week; track day) {
          <pressable
            class="cal-day"
            [class.cal-outside]="!inMonth(day)"
            [class.cal-today]="day === today()"
            [class.cal-selected]="day === selected()"
            accessibilityRole="button"
            [accessibilityLabel]="labelOf(day)"
            [accessibilityState]="{ selected: day === selected() }"
            (press)="selected.set(day)"
          >
            <view class="cal-day-disc">
              <text class="cal-day-number">{{ numberOf(day) }}</text>
            </view>
            <view class="cal-dots">
              @for (color of dots().get(day) ?? []; track color) {
                <view class="cal-dot" [style.--cal-tone]="color"></view>
              }
            </view>
          </pressable>
        }
      </view>
    }
  `,
  styleUrl: './calendar.css',
})
export class CalendarMonth {
  /** The day chosen, `YYYY-MM-DD`. Today unless bound. */
  readonly selected = model<CalendarDate>(dayOf(new Date()));
  /** What is on, for the dots under each day. */
  readonly entries = input<readonly CalendarEntry[]>([]);
  /**
   * The day marked as today: the day the grid was made unless bound, so bind it on a screen that
   * can stay open past midnight.
   */
  readonly today = input<CalendarDate>(dayOf(new Date()));
  /** `1` for Monday first, `0` for Sunday first. */
  readonly weekStart = input<WeekStart>(1);
  /** The locale the month and weekday names are written in. The device's own unless set. */
  readonly locale = input<string | undefined>(undefined);
  /** The colour of an entry without one of its own. */
  readonly defaultColor = input('#4f46e5');

  /** An arrow moved the grid: the first of the month it shows now. */
  readonly monthChange = output<CalendarDate>();

  /** The month shown, as any day in it: the selected day's, until an arrow moves it. */
  private readonly shown = linkedSignal(() => this.selected());

  protected readonly weeks = computed(() => monthGrid(this.shown(), this.weekStart()));
  protected readonly title = computed(() =>
    this.format({ month: 'long', year: 'numeric' }, dateOf(this.shown())),
  );
  protected readonly weekdays = computed(() =>
    weekDates(this.weekStart()).map((date) => this.format({ weekday: 'narrow' }, date)),
  );
  protected readonly dots = computed(() =>
    colorsByDay(this.entries(), this.weeks().flat(), this.defaultColor()),
  );
  protected readonly previousLabel = computed(
    () =>
      `Previous month, ${this.format({ month: 'long', year: 'numeric' }, dateOf(addMonths(this.shown(), -1)))}`,
  );
  protected readonly nextLabel = computed(
    () =>
      `Next month, ${this.format({ month: 'long', year: 'numeric' }, dateOf(addMonths(this.shown(), 1)))}`,
  );

  protected step(by: number): void {
    const moved = addMonths(this.shown(), by);
    this.shown.set(moved);
    this.monthChange.emit(moved);
  }

  protected inMonth(day: CalendarDate): boolean {
    return sameMonth(day, this.shown());
  }

  protected numberOf(day: CalendarDate): number {
    return dateOf(day).getDate();
  }

  /** The day written out, and how much is on it, for a screen reader. */
  protected labelOf(day: CalendarDate): string {
    const count = this.entries().filter((entry) => isOn(entry, day)).length;
    const date = this.format({ weekday: 'long', day: 'numeric', month: 'long' }, dateOf(day));
    return count === 0 ? date : `${date}, ${count === 1 ? '1 event' : `${count} events`}`;
  }

  private format(options: Intl.DateTimeFormatOptions, date: Date): string {
    return new Intl.DateTimeFormat(this.locale(), options).format(date);
  }
}
