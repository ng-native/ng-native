import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  type OnInit,
} from '@angular/core';
import {
  allDayEntries,
  dateOf,
  dayEntries,
  dayOf,
  minuteAt,
  timeOf,
  type CalendarDate,
  type CalendarEntry,
  type DayEntry,
} from './calendar-dates.ts';
import { Pressable, Text, View, type PressEvent } from '@ng-native/components';

/** `(slotPress)`: an empty stretch of the timeline was pressed. */
export interface CalendarSlotPress {
  readonly day: CalendarDate;
  /** Minutes from midnight, snapped down to the quarter hour. */
  readonly minute: number;
  /** The same minute as a date on `day`, ready to start a new event at. */
  readonly start: Date;
}

/**
 * A day as a timeline: the hours down the side, each timed entry as a block from its start to its
 * end, entries that overlap side by side, all-day entries in a row above, and a line at the time
 * now when the day is today.
 *
 * ```html
 * <calendar-day [day]="day()" [entries]="entries()" (entryPress)="open($event)" (slotPress)="add($event)" />
 * ```
 *
 * It is as tall as its hours, so it scrolls inside a `<scroll-view>` rather than on its own.
 */
@Component({
  selector: 'calendar-day',
  imports: [Pressable, Text, View],
  template: `
    @if (allDay().length > 0) {
      <view class="cal-all-day">
        @for (entry of allDay(); track entry.id) {
          <pressable
            class="cal-chip"
            [style.--cal-tone]="entry.color ?? defaultColor()"
            accessibilityRole="button"
            [accessibilityLabel]="entry.title + ', all day'"
            (press)="entryPress.emit(entry)"
          >
            <text class="cal-chip-title" [numberOfLines]="1">{{ entry.title }}</text>
          </pressable>
        }
      </view>
    }
    <pressable
      class="cal-timeline"
      [style.height.px]="height()"
      accessibilityLabel="Timeline"
      (press)="pressSlot($event)"
    >
      @for (hour of hours(); track hour) {
        <view
          class="cal-hour"
          pointerEvents="none"
          [style.top.px]="(hour - startHour()) * hourHeight()"
        >
          <text class="cal-hour-label">{{ hourLabel(hour) }}</text>
          <view class="cal-hour-line"></view>
        </view>
      }
      @for (placed of timed(); track placed.entry.id) {
        <pressable
          class="cal-entry"
          [style.--cal-tone]="placed.entry.color ?? defaultColor()"
          [style.top.px]="topOf(placed.from) + 1"
          [style.height.px]="heightOf(placed) - 2"
          [style.left.%]="(placed.lane / placed.lanes) * 100"
          [style.width.%]="100 / placed.lanes"
          accessibilityRole="button"
          [accessibilityLabel]="labelOf(placed)"
          (press)="entryPress.emit(placed.entry)"
        >
          <text class="cal-entry-title" [numberOfLines]="1">{{ placed.entry.title }}</text>
          @if (heightOf(placed) >= 40) {
            <text class="cal-entry-time" [numberOfLines]="1">{{ spanOf(placed) }}</text>
          }
        </pressable>
      }
      @if (nowShown()) {
        <view
          class="cal-now"
          pointerEvents="none"
          [style.top.px]="topOf(now())"
          accessibilityLabel="Now"
        >
          <view class="cal-now-dot"></view>
        </view>
      }
    </pressable>
  `,
  styleUrl: './calendar.css',
})
export class CalendarDay implements OnInit {
  /** The day shown, `YYYY-MM-DD`. Today unless set. */
  readonly day = input<CalendarDate>(dayOf(new Date()));
  /** What is on. Entries on other days are left out, and ones crossing midnight are cut to it. */
  readonly entries = input<readonly CalendarEntry[]>([]);
  /** The first hour shown, from 0. */
  readonly startHour = input(0);
  /** The hour the timeline ends at, up to 24. */
  readonly endHour = input(24);
  /** How tall an hour is, in points. */
  readonly hourHeight = input(60);
  /** The locale the times are written in. The device's own unless set. */
  readonly locale = input<string | undefined>(undefined);
  /** The colour of an entry without one of its own. */
  readonly defaultColor = input('#4f46e5');

  /** An entry was pressed. */
  readonly entryPress = output<CalendarEntry>();
  /** An empty stretch of the timeline was pressed: somewhere to start a new event. */
  readonly slotPress = output<CalendarSlotPress>();

  private readonly destroyRef = inject(DestroyRef);
  /** Minutes from midnight now, moved on each minute. */
  protected readonly now = signal(minutesNow());

  protected readonly hours = computed(() =>
    Array.from({ length: this.endHour() - this.startHour() + 1 }, (_, i) => this.startHour() + i),
  );
  protected readonly height = computed(
    () => (this.endHour() - this.startHour()) * this.hourHeight(),
  );
  protected readonly allDay = computed(() => allDayEntries(this.entries(), this.day()));
  /** The timed entries, without the parts before the first hour shown or after the last. */
  protected readonly timed = computed(() => {
    const first = this.startHour() * 60;
    const last = this.endHour() * 60;
    return dayEntries(this.entries(), this.day())
      .filter((placed) => placed.to > first && placed.from < last)
      .map((placed) => ({
        ...placed,
        from: Math.max(placed.from, first),
        to: Math.min(placed.to, last),
      }));
  });
  /** Reads `now()` first, so the minute tick checks again whether the day shown has become today. */
  protected readonly nowShown = computed(() => {
    const now = this.now();
    return (
      now >= this.startHour() * 60 && now <= this.endHour() * 60 && this.day() === dayOf(new Date())
    );
  });

  ngOnInit(): void {
    this.followTheClock();
  }

  protected topOf(minute: number): number {
    return ((minute - this.startHour() * 60) / 60) * this.hourHeight();
  }

  protected heightOf(placed: DayEntry): number {
    return Math.max(((placed.to - placed.from) / 60) * this.hourHeight(), 18);
  }

  protected hourLabel(hour: number): string {
    return hour === 24 ? '' : timeOf(hour * 60, this.locale());
  }

  protected spanOf(placed: DayEntry): string {
    return `${this.timeAt(placed.entry.start)} – ${this.timeAt(placed.entry.end)}`;
  }

  protected labelOf(placed: DayEntry): string {
    return `${placed.entry.title}, ${this.timeAt(placed.entry.start)} to ${this.timeAt(placed.entry.end)}`;
  }

  /**
   * A press on the timeline that no entry took: the minute under the finger. Nothing else on the
   * timeline takes a touch, so `locationY` is measured from its top.
   */
  protected pressSlot(event: PressEvent): void {
    const y = event.nativeEvent?.locationY ?? 0;
    const minute = minuteAt(y, this.startHour(), this.endHour(), this.hourHeight());
    const start = dateOf(this.day());
    start.setMinutes(minute);
    this.slotPress.emit({ day: this.day(), minute, start });
  }

  private timeAt(date: Date): string {
    return new Intl.DateTimeFormat(this.locale(), { hour: 'numeric', minute: '2-digit' }).format(
      date,
    );
  }

  private followTheClock(): void {
    const timer = setInterval(() => this.now.set(minutesNow()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }
}

function minutesNow(): number {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}
