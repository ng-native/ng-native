import { Component, signal } from '@angular/core';
import { HlmCalendarImports } from './helm/calendar';

/** Spartan UI's calendar: a month of days to choose one from. */
@Component({
  selector: 'app-spartan-calendars',
  imports: [HlmCalendarImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm" testID="calendar-state">
      Chosen: {{ date()?.toDateString() ?? 'nothing' }}
    </p>
    <hlm-calendar
      [(date)]="date"
      [defaultFocusedDate]="start"
      captionLayout="label"
      class="rounded-md border"
      testID="calendar"
    />
  `,
})
export class SpartanCalendars {
  protected readonly start = new Date(2026, 9, 15);
  protected readonly date = signal<Date | undefined>(undefined);
}
