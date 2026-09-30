/**
 * Fixture for `browser/events.test.ts`: one of each control, every event it has logged in the
 * order it arrived. See `button-app.ts`'s doc comment for why a real `@Component` has to live in
 * its own file rather than inside a test.
 *
 * The pressable's long press is ten seconds off, past any hold a test makes. A long press cancels
 * the press, and at the default 500ms a runner slow enough to stretch a 200ms Space hold past it
 * fails a test that is about something else.
 */
import { Component, signal } from '@angular/core';
import { Pressable, ScrollView, Text, TextInput, View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Pressable, ScrollView, Text, TextInput, View],
  template: `
    <pressable
      id="button"
      accessibilityRole="button"
      (pressIn)="log('pressIn')"
      (press)="log('press')"
      (pressOut)="log('pressOut')"
      (longPress)="log('longPress')"
      delayLongPress="10000"
    >
      <text>Save</text>
    </pressable>
    <text-input
      id="line"
      (focus)="log('focus')"
      (submitEditing)="log('submitEditing')"
      (endEditing)="log('endEditing')"
      (blur)="log('blur')"
    />
    <text-input
      id="chat"
      [multiline]="true"
      submitBehavior="submit"
      [(value)]="chat"
      (submitEditing)="log('submitEditing')"
    />
    <text-input id="notes" [multiline]="true" [(value)]="notes" />
    <scroll-view
      id="strip"
      [horizontal]="true"
      [style]="{ width: 100, height: 50 }"
      (contentSizeChange)="contentSize.set($event)"
      (momentumScrollEnd)="restedAt.set($event.nativeEvent.contentOffset.x)"
    >
      <view [style]="{ width: 80, height: 40 }"></view>
      <view [style]="{ width: 80, height: 40 }"></view>
    </scroll-view>
    <scroll-view id="frozen" [scrollEnabled]="false" [style]="{ height: 20, flexGrow: 0 }">
      <view [style]="{ height: 80 }"></view>
    </scroll-view>
  `,
})
export class EventsApp {
  readonly events = signal<readonly string[]>([]);
  readonly chat = signal('');
  readonly notes = signal('');
  readonly contentSize = signal<{ width: number; height: number } | null>(null);
  readonly restedAt = signal<number | null>(null);

  log(event: string): void {
    this.events.update((events) => [...events, event]);
  }
}
