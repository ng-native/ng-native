import type { RouteMeta } from '@analogjs/router';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'Native components' };

interface Place {
  readonly name: string;
  readonly photo: string;
}

const PLACES: readonly Place[] = [
  { name: 'Lisbon', photo: 'https://picsum.photos/id/1040/400/300' },
  { name: 'Kyoto', photo: 'https://picsum.photos/id/1043/400/300' },
  { name: 'Reykjavik', photo: 'https://picsum.photos/id/1036/400/300' },
  { name: 'Cape Town', photo: 'https://picsum.photos/id/1039/400/300' },
];

/** A page made of the real native components, each one doing something you can try. */
@Component({
  imports: [
    ActivityIndicator,
    FeatureNote,
    Image,
    Modal,
    NativeHeader,
    Pressable,
    RefreshControl,
    ScrollView,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
  ],
  template: `
    <native-header [title]="title" />
    <scroll-view
      class="scroll"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
    >
      <refresh-control [(refreshing)]="refreshing" (refresh)="refresh()" />
      <view class="content">
        <app-feature-note
          file="src/app/pages/components.page.ts"
          explanation="An Analog page is an Angular Native component: every control here is a real UIKit or Android view. Pull down to refresh."
        />

        <text class="section">TRIP</text>
        <view class="card">
          <view class="row">
            <text class="row-title">Traveller</text>
            <text-input
              class="field"
              placeholder="Your name"
              autoCorrect="false"
              accessibilityLabel="Traveller"
              [(value)]="name"
            />
          </view>
          <view class="row row-divider">
            <text class="row-title">Guests</text>
            <view class="stepper">
              <pressable
                class="step"
                accessibilityRole="button"
                accessibilityLabel="Fewer guests"
                [class.step-off]="guests() === 1"
                [disabled]="guests() === 1"
                (press)="guests.set(guests() - 1)"
              >
                <text class="step-label">−</text>
              </pressable>
              <text class="count" accessibilityLabel="Guests">{{ guests() }}</text>
              <pressable
                class="step"
                accessibilityRole="button"
                accessibilityLabel="More guests"
                [class.step-off]="guests() === 6"
                [disabled]="guests() === 6"
                (press)="guests.set(guests() + 1)"
              >
                <text class="step-label">+</text>
              </pressable>
            </view>
          </view>
          <view class="row row-divider">
            <text class="row-title">Window seat</text>
            <switch accessibilityLabel="Window seat" [(checked)]="window" />
          </view>
          <view class="row row-divider">
            <text class="row-title">Trip insurance</text>
            <switch accessibilityLabel="Trip insurance" [(checked)]="insured" />
          </view>
        </view>

        <text class="section">DESTINATION</text>
        <scroll-view
          horizontal
          class="places"
          [showsHorizontalScrollIndicator]="false"
          [contentContainerStyle]="{ paddingRight: 16 }"
        >
          @for (place of places; track place.name) {
            <pressable
              class="place"
              [class.place-chosen]="place.name === destination()"
              accessibilityRole="button"
              [accessibilityLabel]="place.name"
              [accessibilityState]="{ selected: place.name === destination() }"
              (press)="destination.set(place.name)"
            >
              <image class="photo" [source]="{ uri: place.photo }" [alt]="place.name" />
              <text class="place-name">{{ place.name }}</text>
            </pressable>
          }
        </scroll-view>

        <text class="section">SUMMARY</text>
        <view class="card summary">
          <text class="summary-line" accessibilityLabel="Summary">{{ summary() }}</text>
          <view class="meter">
            <view class="meter-fill" [style.width]="readiness() + '%'"></view>
          </view>
          <text class="row-sub">{{ readiness() }}% ready</text>
          @if (booking()) {
            <view class="pending">
              <activity-indicator />
              <text class="row-sub">Booking…</text>
            </view>
          } @else {
            <touchable-opacity
              class="book"
              accessibilityRole="button"
              accessibilityLabel="Book trip"
              (press)="book()"
            >
              <text class="book-label">Book trip</text>
            </touchable-opacity>
          }
        </view>
        @if (refreshed()) {
          <text class="row-sub center">Prices refreshed {{ refreshed() }} times</text>
        }
      </view>
    </scroll-view>

    @if (booked()) {
      <modal animationType="slide" presentationStyle="pageSheet" (requestClose)="booked.set(false)">
        <view class="sheet">
          <text class="sheet-title">Booked</text>
          <text class="sheet-body">{{ summary() }}</text>
          <touchable-opacity
            class="book"
            accessibilityRole="button"
            accessibilityLabel="Done"
            (press)="booked.set(false)"
          >
            <text class="book-label">Done</text>
          </touchable-opacity>
        </view>
      </modal>
    }
  `,
  styleUrl: '../ui/page.css',
  styles: `
    .row {
      min-height: 52px;
    }

    .field {
      flex: 1;
      text-align: right;
      font-size: 17px;
      color: light-dark(#1c1c1e, #ffffff);
    }

    .stepper {
      flex-direction: row;
      align-items: center;
      gap: 14px;
    }

    .step {
      width: 34px;
      height: 34px;
      border-radius: 17px;
      align-items: center;
      justify-content: center;
      background-color: light-dark(#e9e9ee, #2c2c2e);
    }

    .step-off {
      opacity: 0.4;
    }

    .step-label {
      font-size: 20px;
      color: #dd0330;
    }

    .count {
      min-width: 18px;
      text-align: center;
      font-size: 17px;
      font-weight: 600;
      color: light-dark(#1c1c1e, #ffffff);
    }

    .places {
      flex-grow: 0;
      margin: 0 -16px;
    }

    .place {
      width: 150px;
      margin-left: 16px;
      border-radius: 14px;
      overflow: hidden;
      border-width: 3px;
      border-color: transparent;
      background-color: light-dark(#ffffff, #1c1c1e);
    }

    .place-chosen {
      border-color: #dd0330;
    }

    .photo {
      width: 100%;
      height: 100px;
    }

    .place-name {
      padding: 8px 10px;
      font-size: 15px;
      font-weight: 600;
      color: light-dark(#1c1c1e, #ffffff);
    }

    .summary {
      padding: 16px;
      gap: 10px;
    }

    .summary-line {
      font-size: 17px;
      color: light-dark(#1c1c1e, #ffffff);
    }

    .meter {
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
      background-color: light-dark(#e9e9ee, #2c2c2e);
    }

    .meter-fill {
      height: 100%;
      background-color: #dd0330;
    }

    .pending {
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 48px;
    }

    .book {
      height: 48px;
      border-radius: 12px;
      align-items: center;
      justify-content: center;
      background-color: #dd0330;
    }

    .book-label {
      color: #ffffff;
      font-size: 17px;
      font-weight: 600;
    }

    .center {
      text-align: center;
    }

    .sheet {
      flex: 1;
      padding: 32px 24px;
      gap: 16px;
      background-color: light-dark(#ffffff, #1c1c1e);
    }

    .sheet-title {
      font-size: 28px;
      font-weight: 700;
      color: light-dark(#1c1c1e, #ffffff);
    }

    .sheet-body {
      font-size: 17px;
      color: light-dark(#3a3a3c, #d1d1d6);
    }
  `,
})
export default class ComponentsPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly places = PLACES;

  protected readonly name = signal('');
  protected readonly guests = signal(2);
  protected readonly window = signal(true);
  protected readonly insured = signal(false);
  protected readonly destination = signal<string | null>(null);
  protected readonly booking = signal(false);
  protected readonly booked = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly refreshed = signal(0);

  protected readonly summary = computed(() => {
    const who = this.name().trim() || 'You';
    const where = this.destination() ?? 'somewhere';
    const seat = this.window() ? ', window seat' : '';
    const cover = this.insured() ? ', insured' : '';
    return `${who} + ${this.guests() - 1} to ${where}${seat}${cover}`;
  });

  protected readonly readiness = computed(() => {
    const steps = [this.name().trim() !== '', this.destination() !== null, this.insured()];
    return Math.round((100 * steps.filter(Boolean).length) / steps.length);
  });

  protected book(): void {
    this.booking.set(true);
    setTimeout(() => {
      this.booking.set(false);
      this.booked.set(true);
    }, 800);
  }

  protected refresh(): void {
    setTimeout(() => {
      this.refreshed.update((count) => count + 1);
      this.refreshing.set(false);
    }, 600);
  }
}
