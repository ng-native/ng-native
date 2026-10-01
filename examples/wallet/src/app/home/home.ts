import { Component, computed, inject } from '@angular/core';
import { Pressable, SafeAreaView, ScrollView, Text, View } from '@ng-native/components';
import { SecureStorage } from '@ng-native/expo/secure-store';
import { NativeNavigation } from '@ng-native/router';
import { Ledger, money } from '../payments/ledger.ts';
import { PaymentRow } from '../payments/payment-row.ts';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The home screen: the balance, a week of spending and the latest payments. Tapping the card
 * hides the balance, and the choice is kept in the keychain for next time.
 */
@Component({
  selector: 'app-home',
  imports: [PaymentRow, Pressable, SafeAreaView, ScrollView, Text, View],
  template: `
    <safe-area-view class="flex-1 bg-zinc-100 dark:bg-black" [edges]="['top']">
      <scroll-view class="flex-1">
        <view class="gap-5 px-5 pt-4 pb-8">
          <view class="flex-row items-center justify-between">
            <view>
              <text class="text-sm text-zinc-500">Good {{ partOfDay }}</text>
              <text class="text-2xl font-bold text-zinc-900 dark:text-white">Ada Lovelace</text>
            </view>
            <view
              class="size-11 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-700"
            >
              <text class="font-semibold text-white">AL</text>
            </view>
          </view>

          <pressable
            class="rounded-3xl bg-linear-to-br from-zinc-900 via-indigo-950 to-rose-900 p-5 active:opacity-90"
            accessibilityRole="button"
            [accessibilityLabel]="hidden() ? 'Show balance' : 'Hide balance'"
            (press)="hidden.set(!hidden())"
          >
            <view class="flex-row justify-between">
              <text class="text-sm text-white/60">Total balance</text>
              <text class="text-sm font-semibold text-white/60">{{
                hidden() ? 'Show' : 'Hide'
              }}</text>
            </view>
            <text class="mt-2 text-4xl font-bold text-white">{{ balance() }}</text>
            <view class="mt-6 flex-row items-center justify-between">
              <text class="text-sm tracking-widest text-white/60">•••• 4821</text>
              <text class="text-base font-bold text-white italic">VISA</text>
            </view>
          </pressable>

          <pressable
            class="items-center rounded-2xl bg-rose-600 p-4 active:bg-rose-700"
            accessibilityRole="button"
            (press)="send()"
          >
            <text class="text-base font-semibold text-white">Send money</text>
          </pressable>

          <view class="rounded-3xl bg-white p-5 dark:bg-zinc-900">
            <text class="text-sm text-zinc-500">Spent this week</text>
            <text class="mt-1 text-xl font-bold text-zinc-900 dark:text-white">{{ spent() }}</text>
            <view class="mt-4 h-24 flex-row items-end justify-between">
              @for (day of week(); track $index) {
                <view class="items-center gap-1.5">
                  <view
                    class="w-7 rounded-lg"
                    [class]="day.today ? 'bg-rose-600' : 'bg-zinc-200 dark:bg-zinc-700'"
                    [style.height.px]="day.height"
                  ></view>
                  <text class="text-[10px] text-zinc-400">{{ day.name }}</text>
                </view>
              }
            </view>
          </view>

          <view class="flex-row items-center justify-between">
            <text class="text-base font-bold text-zinc-900 dark:text-white">Recent</text>
            <pressable accessibilityRole="link" (press)="seeAll()">
              <text class="text-sm font-semibold text-rose-600">See all</text>
            </pressable>
          </view>
          @for (payment of recent(); track payment.id) {
            <pressable
              class="active:opacity-60"
              accessibilityRole="button"
              (press)="open(payment.id)"
            >
              <app-payment-row [payment]="payment" />
            </pressable>
          }
        </view>
      </scroll-view>
    </safe-area-view>
  `,
})
export class Home {
  private readonly ledger = inject(Ledger);
  private readonly navigation = inject(NativeNavigation);

  /** The same signal the settings screen binds, so both stay in step. */
  protected readonly hidden = inject(SecureStorage).signal('hide-balance', false);

  protected readonly partOfDay = partOfDay(new Date());
  protected readonly balance = computed(() =>
    this.hidden() ? '£ ••••••' : money(this.ledger.balance()),
  );
  protected readonly recent = computed(() => this.ledger.payments().slice(0, 4));
  protected readonly week = computed(() => spendingByDay(this.ledger.payments(), new Date()));
  protected readonly spent = computed(() =>
    money(this.week().reduce((sum, day) => sum + day.pence, 0)),
  );

  protected send(): void {
    void this.navigation.present(['/send']);
  }

  protected seeAll(): void {
    void this.navigation.push(['/activity']);
  }

  protected open(id: string): void {
    void this.navigation.push(['/payment', id]);
  }
}

function partOfDay(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/** The last seven days of spending, oldest first, as bars up to 80pt tall. */
function spendingByDay(payments: readonly { pence: number; date: Date }[], today: Date) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
    const pence = payments
      .filter((p) => p.pence < 0 && p.date.toDateString() === date.toDateString())
      .reduce((sum, p) => sum - p.pence, 0);
    return { name: WEEKDAYS[date.getDay()]!, pence, today: i === 6 };
  });
  const most = Math.max(1, ...days.map((d) => d.pence));
  return days.map((d) => ({ ...d, height: Math.max(6, Math.round((d.pence / most) * 80)) }));
}
