import { Component, signal } from '@angular/core';
import {
  CalendarDay,
  CalendarMonth,
  type CalendarEntry,
  type CalendarSlotPress,
} from '@ng-native/components/calendar';

/** A month to pick a day from, and that day's timeline below it, as an app puts them together. */
@Component({
  selector: 'x-calendar-views',
  imports: [CalendarDay, CalendarMonth],
  template: `
    <calendar-month
      [(selected)]="selected"
      (monthChange)="months.push($event)"
      [entries]="entries()"
      [today]="today()"
      [weekStart]="weekStart()"
      locale="en-GB"
    />
    <calendar-day
      [day]="selected()"
      [entries]="entries()"
      [startHour]="7"
      [endHour]="22"
      [hourHeight]="60"
      locale="en-GB"
      (entryPress)="pressed.push($event.id)"
      (slotPress)="slots.push($event)"
    />
  `,
})
export class CalendarViews {
  readonly selected = signal('2026-10-14');
  readonly months: string[] = [];
  readonly today = signal('2026-10-13');
  readonly weekStart = signal<0 | 1>(1);
  readonly entries = signal<readonly CalendarEntry[]>([]);
  readonly pressed: string[] = [];
  readonly slots: CalendarSlotPress[] = [];
}
