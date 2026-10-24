import { Component, computed, inject, signal } from '@angular/core';
import type { ExpoCalendar, ExpoCalendarEvent } from 'expo-calendar';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import {
  CalendarDay,
  CalendarMonth,
  addMonths,
  dateOf,
  dayOf,
  type CalendarDate,
  type CalendarEntry,
  type CalendarSlotPress,
} from './calendar-views.ts';
import { Calendar } from '@ng-native/expo/calendar';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

const at = (day: CalendarDate, hour: number, minute = 0) => {
  const date = dateOf(day);
  date.setHours(hour, minute);
  return date;
};

/** A few entries around today: overlaps, an all-day one and one crossing midnight. */
function samples(today: CalendarDate): CalendarEntry[] {
  const tomorrow = dayOf(new Date(dateOf(today).getTime() + 86_400_000));
  return [
    { id: 's1', title: 'Stand-up', start: at(today, 9), end: at(today, 9, 15), color: '#4f46e5' },
    { id: 's2', title: 'Design review', start: at(today, 10), end: at(today, 11, 30) },
    { id: 's3', title: 'Lunch', start: at(today, 10, 45), end: at(today, 12), color: '#ea580c' },
    { id: 's4', title: 'Gym', start: at(today, 18), end: at(today, 19), color: '#059669' },
    {
      id: 's5',
      title: 'Late deploy',
      start: at(today, 23),
      end: at(tomorrow, 1),
      color: '#dc2626',
    },
    { id: 's6', title: 'Holiday', start: at(tomorrow, 0), end: at(tomorrow, 23, 59), allDay: true },
  ];
}

/**
 * The month and day views over sample entries and, once allowed, the device's own
 * events from `@ng-native/expo/calendar`. A tap on an empty slot adds a local entry there.
 */
@Component({
  selector: 'x-device-calendar',
  imports: [CalendarDay, CalendarMonth, NativeHeader, Pressable, ScrollView, Text, View],
  template: `
    <native-header title="Device calendar" />
    <scroll-view class="screen">
      <view [style]="page.content">
        <calendar-month
          [(selected)]="selected"
          [entries]="entries()"
          [weekStart]="weekStart()"
          (monthChange)="showMonth($event)"
        />
        <view [style]="page.row">
          <pressable class="button" (press)="toggleWeekStart()">
            <text class="button-label">{{
              weekStart() === 1 ? 'Monday first' : 'Sunday first'
            }}</text>
          </pressable>
          <pressable class="button" (press)="selected.set(today)">
            <text class="button-label">Today</text>
          </pressable>
        </view>
        <text class="body">{{ status() }}</text>
        <text class="hint">Selected {{ selected() }}, month shown {{ month() }}</text>

        <view [style]="page.row">
          <pressable class="button" (press)="loadDevice()">
            <text class="button-label">Load device events</text>
          </pressable>
          <pressable class="button" (press)="pick()">
            <text class="button-label">Pick calendar</text>
          </pressable>
        </view>
        <view [style]="page.row">
          <pressable class="button" (press)="addDeviceEvent()">
            <text class="button-label">Add device event</text>
          </pressable>
          <pressable class="button" (press)="deleteAdded()">
            <text class="button-label">Delete it</text>
          </pressable>
        </view>
        <view [style]="page.row">
          <pressable class="button" (press)="askReminders()">
            <text class="button-label">Reminders</text>
          </pressable>
        </view>
        <text class="hint">
          Calendars: {{ calendar.permission.status() }}, reminders:
          {{ calendar.remindersPermission.status() }}
        </text>
        <text class="hint">{{ deviceInfo() }}</text>

        <calendar-day
          [day]="selected()"
          [entries]="entries()"
          [startHour]="6"
          [hourHeight]="56"
          (entryPress)="status.set('Pressed ' + $event.title)"
          (slotPress)="addLocal($event)"
        />
      </view>
    </scroll-view>
  `,
})
export class DeviceCalendarPage {
  protected readonly calendar = inject(Calendar);
  protected readonly page = page;
  protected readonly today = dayOf(new Date());
  protected readonly selected = signal<CalendarDate>(this.today);
  protected readonly month = signal<CalendarDate>(addMonths(this.today, 0));
  protected readonly weekStart = signal<0 | 1>(1);
  protected readonly status = signal('Tap an entry, or an empty slot on the timeline');
  protected readonly deviceInfo = signal('');
  private readonly local = signal<CalendarEntry[]>(samples(this.today));
  private readonly device = signal<CalendarEntry[]>([]);
  private readonly calendars = signal<ExpoCalendar[]>([]);
  private added: ExpoCalendarEvent | null = null;
  protected readonly entries = computed(() => [...this.local(), ...this.device()]);

  protected toggleWeekStart(): void {
    this.weekStart.update((start) => (start === 1 ? 0 : 1));
  }

  protected showMonth(first: CalendarDate): void {
    this.month.set(first);
    if (this.calendars().length > 0) void this.loadMonth();
  }

  protected addLocal(slot: CalendarSlotPress): void {
    const end = new Date(slot.start.getTime() + 45 * 60_000);
    const id = `local-${Date.now()}`;
    this.local.update((all) => [
      ...all,
      { id, title: 'New', start: slot.start, end, color: '#0891b2' },
    ]);
    this.status.set(`Added at ${slot.start.toLocaleTimeString()} (minute ${slot.minute})`);
  }

  protected async loadDevice(): Promise<void> {
    if (!(await this.calendar.permission.ensure())) {
      this.status.set(`Calendar access: ${this.calendar.permission.status()}`);
      return;
    }
    this.calendars.set(await this.calendar.calendars());
    const sources = this.calendar.sources();
    const fallback = this.calendar.defaultCalendar();
    this.deviceInfo.set(
      `${this.calendars().length} calendars, ${sources.length} sources, default ${fallback?.title ?? 'none'}`,
    );
    await this.loadMonth();
  }

  protected async pick(): Promise<void> {
    const picked = await this.calendar.pickCalendar();
    this.status.set(picked ? `Picked ${picked.title}` : 'No calendar picked');
  }

  protected async addDeviceEvent(): Promise<void> {
    if (!(await this.calendar.permission.ensure())) {
      this.status.set(`Calendar access: ${this.calendar.permission.status()}`);
      return;
    }
    const target =
      this.calendar.defaultCalendar() ??
      (await this.calendar.calendars()).find((each) => each.allowsModifications);
    if (!target) {
      this.status.set('No writable calendar');
      return;
    }
    const start = at(this.selected(), 14);
    this.added = await target.createEvent({
      title: 'ng-native test',
      startDate: start,
      endDate: new Date(start.getTime() + 3_600_000),
    });
    this.status.set(`Added "${this.added.title}" to ${target.title} at 14:00`);
    if (this.calendars().length > 0) await this.loadMonth();
  }

  protected async deleteAdded(): Promise<void> {
    if (!this.added) {
      this.status.set('Nothing added yet');
      return;
    }
    await this.added.delete();
    this.added = null;
    this.status.set('Deleted the test event');
    if (this.calendars().length > 0) await this.loadMonth();
  }

  protected async askReminders(): Promise<void> {
    this.status.set(
      `Reminders: ${(await this.calendar.remindersPermission.request()) ? 'granted' : 'refused'}`,
    );
  }

  private async loadMonth(): Promise<void> {
    // A week either side, so the grid's leading and trailing days get dots too.
    const start = new Date(dateOf(this.month()).getTime() - 7 * 86_400_000);
    const end = new Date(dateOf(addMonths(this.month(), 1)).getTime() + 7 * 86_400_000);
    const colors = new Map(this.calendars().map((each) => [each.id, each.color]));
    const events = await this.calendar.events(this.calendars(), start, end);
    this.device.set(
      events.map((event) => ({
        id: `device-${event.id}-${String(event.startDate)}`,
        title: event.title,
        start: new Date(event.startDate),
        end: new Date(event.endDate),
        allDay: event.allDay,
        color: colors.get(event.calendarId),
      })),
    );
    this.deviceInfo.update(
      (info) => `${info.split(' · ')[0]} · ${events.length} events this month`,
    );
  }
}
