import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { ScreenSafeAreaView } from '../../router/src/screen-safe-area-view.ts';

/** What the page below binds on its header, for a test to change. */
export const header = signal<{
  hidden?: boolean;
  translucent?: boolean;
  largeTitle?: boolean;
  absent?: boolean;
}>({});

/** Whether the page shows a line written at its root after it first rendered. */
export const later = signal(false);

/** A page of a stack with its content at the root of its template, as an app writes one. */
@Component({
  selector: 'x-opening-hours',
  imports: [NativeHeader, ScreenSafeAreaView, Text],
  template: `
    @if (!header().absent) {
      <native-header
        title="Opening hours"
        [hidden]="header().hidden"
        [translucent]="header().translucent"
        [largeTitle]="header().largeTitle"
      />
    }
    <text>Monday to Friday</text>
    <screen-safe-area-view nativeID="own" [edges]="['top', 'bottom']">
      <text>Weekends</text>
    </screen-safe-area-view>
    @if (later()) {
      <text>Closed on holidays</text>
    }
  `,
})
export class OpeningHours {
  protected readonly header = header;
  protected readonly later = later;
}

@Component({
  selector: 'x-opening-hours-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class OpeningHoursStack {}
