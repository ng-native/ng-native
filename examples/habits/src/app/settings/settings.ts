import { Component, computed, inject, signal } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideFlame } from '@ng-icons/lucide';
import { NgIcon } from '@ng-native/icons';
import { Notifications, TriggerType } from '@ng-native/expo/notifications';
import { Pressable, SafeAreaView, ScrollView, Switch, Text, View } from '@ng-native/components';
import { DeepLinks } from '@ng-native/device';
import { Habits } from '../data/habits.ts';

/**
 * Reminders and a quick look at every streak. The `Notifications` service covers the permission
 * dialog, the denied state and the scheduling: one daily notification per habit that has a
 * reminder time.
 */
@Component({
  selector: 'app-settings',
  imports: [NgIcon, Pressable, SafeAreaView, ScrollView, Switch, Text, View],
  providers: [provideIcons({ lucideFlame })],
  template: `
    <safe-area-view class="flex-1 bg-zinc-100 dark:bg-black" [edges]="['top']">
      <scroll-view class="flex-1">
        <text class="px-5 pt-4 pb-3 text-3xl font-bold text-zinc-900 dark:text-white"
          >Settings</text
        >

        <text class="px-5 pt-4 pb-2 text-xs text-zinc-500 uppercase">Reminders</text>
        <view class="bg-white dark:bg-zinc-900 ios:mx-4 ios:rounded-xl">
          <view class="flex-row items-center justify-between px-4 py-3">
            <text class="text-zinc-900 dark:text-white">Daily reminders</text>
            <switch
              accessibilityLabel="Daily reminders"
              [checked]="remindersOn()"
              (checkedChange)="toggleReminders($event)"
            />
          </view>
          @if (permission.blocked()) {
            <text class="px-4 pb-3 text-sm text-rose-600">
              Notifications are turned off for Habits. Enable them in the system Settings app to get
              reminders.
            </text>
            <pressable class="px-4 pb-3" accessibilityRole="button" (press)="links.openSettings()">
              <text class="text-sm font-semibold text-sky-600">Open Settings</text>
            </pressable>
          }
        </view>

        <text class="px-5 pt-6 pb-2 text-xs text-zinc-500 uppercase">Streaks</text>
        <view class="bg-white dark:bg-zinc-900 ios:mx-4 ios:rounded-xl">
          @for (habit of habits(); track habit.id; let last = $last) {
            <view
              class="flex-row items-center justify-between px-4 py-3"
              [class]="last ? '' : 'border-b-hairline border-zinc-200 dark:border-zinc-800'"
            >
              <view class="flex-row items-center gap-3">
                <view class="size-3 rounded-full" [style.background-color]="habit.colour"></view>
                <text class="text-zinc-900 dark:text-white">{{ habit.name }}</text>
              </view>
              <view class="flex-row items-center gap-1">
                <ng-icon name="lucideFlame" size="14" color="#f97316" />
                <text class="text-sm font-semibold text-zinc-500">{{ streak(habit.id) }}</text>
              </view>
            </view>
          } @empty {
            <text class="px-4 py-3 text-zinc-500">No habits yet.</text>
          }
        </view>
      </scroll-view>
    </safe-area-view>
  `,
})
export class Settings {
  private readonly habitsService = inject(Habits);
  private readonly notifications = inject(Notifications);
  protected readonly links = inject(DeepLinks);

  protected readonly habits = this.habitsService.habits;
  protected readonly permission = this.notifications.permission;
  protected readonly remindersOn = signal(false);

  protected streak(id: string): number {
    return this.habitsService.streak(id);
  }

  protected async toggleReminders(wants: boolean): Promise<void> {
    if (!wants) {
      this.remindersOn.set(false);
      await this.notifications.cancelAll();
      return;
    }
    const granted = await this.permission.ensure();
    this.remindersOn.set(granted);
    if (granted) await this.scheduleReminders();
  }

  private async scheduleReminders(): Promise<void> {
    await this.notifications.cancelAll();
    for (const habit of this.habits()) {
      if (!habit.reminderTime) continue;
      const [hour, minute] = habit.reminderTime.split(':').map(Number);
      await this.notifications.schedule({
        identifier: habit.id,
        content: { title: habit.name, body: "Don't forget today." },
        trigger: { type: TriggerType.DAILY, hour: hour ?? 9, minute: minute ?? 0 },
      });
    }
  }
}
