import type { RouteMeta } from '@analogjs/router';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  lucideBookmark,
  lucideCheck,
  lucidePause,
  lucidePlay,
  lucidePlus,
  lucideSearch,
  lucideSkipForward,
  lucideX,
} from '@ng-icons/lucide';
import {
  GradientText,
  Image,
  ImageBackground,
  KeyboardDock,
  KeyboardLift,
  Pressable,
  SectionHeader,
  SectionItem,
  SectionList,
  Text,
  TextInput,
  View,
  VirtualList,
  VirtualListRow,
} from '@ng-native/components';
import { Animated, AnimatedStyle } from '@ng-native/components/animations';
import { GestureRoot, NativeGesture } from '@ng-native/components/gestures';
import { ColorScheme } from '@ng-native/device';
import { NgIcon } from '@ng-native/icons';
import { NativeHeader, ScreenSafeAreaView } from '@ng-native/router';
import { Gesture } from 'react-native-gesture-handler';
import { EPISODES, searchEpisodes, showSections, type Episode } from '../data/podcasts.ts';
import { FeatureNote } from '../ui/feature-note.ts';

export const routeMeta: RouteMeta = { title: 'More native components' };

/** An episode row's height, its divider included. */
const ROW = 76;
/** How far the Up next card is dragged before letting go sends it away. */
const THROW = 110;

type Library = 'episodes' | 'shows';

/**
 * The Up next card's drag: a pan recognised by the platform whose callbacks run on the JavaScript
 * thread, writing to `drag`. Past `THROW`, or flung, the card goes; short of it, it springs back.
 * Its callbacks read only what is passed in, since the worklet Babel plugin rewrites them.
 */
function swipeGesture(drag: Animated.Value, send: (direction: 1 | -1) => void) {
  return Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((event: { translationX: number }) => drag.setValue(event.translationX))
    .onEnd((event: { translationX: number; velocityX: number }) => {
      const thrown = Math.abs(event.translationX) > THROW || Math.abs(event.velocityX) > 900;
      if (thrown) send(event.translationX > 0 ? 1 : -1);
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    });
}

/** A podcast library made of the native components the first components page does not use. */
@Component({
  imports: [
    AnimatedStyle,
    FeatureNote,
    GestureRoot,
    GradientText,
    Image,
    ImageBackground,
    KeyboardDock,
    KeyboardLift,
    NativeGesture,
    NativeHeader,
    NgIcon,
    Pressable,
    ScreenSafeAreaView,
    SectionHeader,
    SectionItem,
    SectionList,
    Text,
    TextInput,
    View,
    VirtualList,
    VirtualListRow,
  ],
  providers: [
    provideIcons({
      lucideBookmark,
      lucideCheck,
      lucidePause,
      lucidePlay,
      lucidePlus,
      lucideSearch,
      lucideSkipForward,
      lucideX,
    }),
  ],
  template: `
    <native-header [title]="title" />
    <gesture-root>
      <view class="screen">
        <screen-safe-area-view class="fill" [edges]="['top']">
          <view class="segments" accessibilityRole="tablist">
            @for (option of libraries; track option.value) {
              <pressable
                class="segment"
                [class.segment-on]="library() === option.value"
                accessibilityRole="tab"
                [accessibilityLabel]="option.label"
                [accessibilityState]="{ selected: library() === option.value }"
                (press)="library.set(option.value)"
              >
                <text class="segment-label" [class.segment-label-on]="library() === option.value">
                  {{ option.label }}
                </text>
              </pressable>
            }
          </view>

          <view class="fill clip">
            <view class="fill" [keyboardLift]="dock">
              @if (library() === 'episodes') {
                <virtual-list
                  #list
                  class="fill"
                  [items]="episodes()"
                  [itemHeight]="rowHeight"
                  keyboardDismissMode="interactive"
                >
                  <view listHeader class="content">
                    @if (query() === '') {
                      <app-feature-note
                        file="src/app/pages/more-components.page.ts"
                        explanation="A virtual list that recycles its rows, a section list with sticky headers, gradient text over an image background, a card dragged by a native gesture and animated, and a search bar riding the keyboard."
                      />
                      <image-background
                        class="hero"
                        [source]="{ uri: featured.show.artwork }"
                        [imageStyle]="{ borderRadius: 14 }"
                      >
                        <view class="hero-shade">
                          <text class="hero-kicker">FEATURED SHOW</text>
                          <gradient-text class="hero-title">{{ featured.show.name }}</gradient-text>
                          <text class="hero-sub">
                            New episodes every Tuesday, with {{ featured.show.host }}
                          </text>
                        </view>
                      </image-background>

                      <text class="section">UP NEXT</text>
                      @if (next(); as up) {
                        <view
                          class="card deck"
                          accessibilityLabel="Up next"
                          [gesture]="swipe"
                          [animatedStyle]="deckStyle"
                        >
                          <image class="deck-art" [source]="{ uri: up.show.artwork }" />
                          <view class="row-body">
                            <text class="row-sub">{{ up.show.name }} · #{{ up.number }}</text>
                            <text class="deck-title" [numberOfLines]="2">{{ up.title }}</text>
                            <text class="row-sub">Swipe right to save, left to skip</text>
                          </view>
                        </view>
                        <view class="deck-actions">
                          <pressable
                            class="deck-button"
                            accessibilityRole="button"
                            accessibilityLabel="Skip"
                            (press)="send(-1)"
                          >
                            <ng-icon name="lucideSkipForward" [size]="18" color="#8e8e93" />
                            <text class="deck-button-label">Skip</text>
                          </pressable>
                          <pressable
                            class="deck-button"
                            accessibilityRole="button"
                            accessibilityLabel="Save"
                            (press)="send(1)"
                          >
                            <ng-icon name="lucideBookmark" [size]="18" color="#dd0330" />
                            <text class="deck-button-label accent">Save</text>
                          </pressable>
                        </view>
                      } @else {
                        <view class="card deck-done">
                          <text class="row-sub">You are all caught up</text>
                        </view>
                      }
                      <text class="row-sub center">{{ saved().length }} saved for later</text>
                    }
                    <text class="section list-label">{{ episodesLabel() }}</text>
                  </view>

                  @for (row of list.window(); track row.slot) {
                    <view [virtualListRow]="row" class="episode-slot">
                      <pressable
                        class="episode"
                        accessibilityRole="button"
                        [accessibilityLabel]="'#' + row.item.number + ' ' + row.item.title"
                        (press)="togglePlaying(row.item)"
                      >
                        <image class="episode-art" [source]="{ uri: row.item.show.artwork }" />
                        <view class="row-body">
                          <text
                            class="episode-title"
                            [class.accent]="playing() === row.item.id"
                            [numberOfLines]="1"
                            >{{ row.item.title }}</text
                          >
                          <text class="row-sub" [numberOfLines]="1">
                            #{{ row.item.number }} · {{ row.item.show.name }} ·
                            {{ row.item.minutes }} min
                          </text>
                        </view>
                        <view class="play" [class.play-on]="playing() === row.item.id">
                          <ng-icon
                            [name]="playing() === row.item.id ? 'lucidePause' : 'lucidePlay'"
                            [size]="16"
                            [color]="playing() === row.item.id ? '#ffffff' : '#dd0330'"
                          />
                        </view>
                      </pressable>
                    </view>
                  }

                  <text listFooter class="row-sub center footer">
                    @if (episodes().length === 0) {
                      No episodes match “{{ query() }}”
                    } @else {
                      That is every episode
                    }
                  </text>
                </virtual-list>
              } @else {
                <section-list
                  class="fill"
                  [sections]="shows()"
                  [itemHeight]="64"
                  [sectionHeaderHeight]="32"
                  [stickySectionHeadersEnabled]="true"
                >
                  <ng-template sectionHeader let-section>
                    <view class="letter" accessibilityRole="header">
                      <text class="letter-text">{{ section.title }}</text>
                    </view>
                  </ng-template>
                  <ng-template sectionItem let-show>
                    <view class="show">
                      <image class="show-art" [source]="{ uri: show.artwork }" />
                      <view class="row-body">
                        <text class="row-title">{{ show.name }}</text>
                        <text class="row-sub">{{ show.host }}</text>
                      </view>
                      <pressable
                        class="follow"
                        [class.follow-on]="followed().has(show.id)"
                        accessibilityRole="button"
                        [accessibilityLabel]="
                          (followed().has(show.id) ? 'Unfollow ' : 'Follow ') + show.name
                        "
                        (press)="toggleFollow(show.id)"
                      >
                        <ng-icon
                          [name]="followed().has(show.id) ? 'lucideCheck' : 'lucidePlus'"
                          [size]="16"
                          [color]="followed().has(show.id) ? '#ffffff' : '#dd0330'"
                        />
                      </pressable>
                    </view>
                  </ng-template>
                  <text listFooter class="row-sub center footer">
                    @if (shows().length === 0) {
                      No shows match “{{ query() }}”
                    } @else {
                      Following {{ followed().size }} shows
                    }
                  </text>
                </section-list>
              }
            </view>
          </view>
        </screen-safe-area-view>

        <keyboard-dock #dock [backgroundColor]="dockColor()">
          <view class="search-bar">
            <view class="search">
              <ng-icon name="lucideSearch" [size]="18" color="#8e8e93" />
              <text-input
                class="search-field"
                placeholder="Search episodes and shows"
                placeholderTextColor="#8e8e93"
                autoCorrect="false"
                returnKeyType="search"
                accessibilityLabel="Search"
                [(value)]="query"
              />
              @if (query() !== '') {
                <pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  [hitSlop]="10"
                  (press)="query.set('')"
                >
                  <ng-icon name="lucideX" [size]="18" color="#8e8e93" />
                </pressable>
              }
            </view>
          </view>
        </keyboard-dock>
      </view>
    </gesture-root>
  `,
  styleUrl: '../ui/page.css',
  styles: `
    .screen {
      flex: 1;
      background-color: light-dark(#f2f2f7, #000000);
    }

    .fill {
      flex: 1;
    }

    .clip {
      overflow: hidden;
    }

    .segments {
      flex-direction: row;
      margin: 8px 16px;
      padding: 2px;
      border-radius: 9px;
      background-color: light-dark(#e3e3e8, #1c1c1e);
    }

    .segment {
      flex: 1;
      height: 32px;
      border-radius: 7px;
      align-items: center;
      justify-content: center;
    }

    .segment-on {
      background-color: light-dark(#ffffff, #3a3a3c);
    }

    .segment-label {
      font-size: 14px;
      font-weight: 500;
      color: light-dark(#3a3a3c, #d1d1d6);
    }

    .segment-label-on {
      font-weight: 600;
      color: light-dark(#1c1c1e, #ffffff);
    }

    .hero {
      height: 190px;
      border-radius: 14px;
      overflow: hidden;
    }

    .hero-shade {
      flex: 1;
      justify-content: flex-end;
      gap: 4px;
      padding: 16px;
      background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.7));
    }

    .hero-kicker {
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
    }

    .hero-title {
      background-image: linear-gradient(to right, #ffffff, #ff8fa3 55%, #dd0330);
      background-clip: text;
      color: transparent;
      font-size: 36px;
      font-weight: 800;
    }

    .hero-sub {
      color: rgba(255, 255, 255, 0.85);
      font-size: 14px;
    }

    .deck {
      flex-direction: row;
      align-items: center;
      gap: 14px;
      padding: 14px;
    }

    .deck-art {
      width: 72px;
      height: 72px;
      border-radius: 10px;
    }

    .deck-title {
      color: light-dark(#1c1c1e, #ffffff);
      font-size: 17px;
      font-weight: 600;
    }

    .deck-actions {
      flex-direction: row;
      gap: 12px;
      margin-top: -8px;
    }

    .deck-button {
      flex: 1;
      flex-direction: row;
      gap: 6px;
      height: 40px;
      border-radius: 10px;
      align-items: center;
      justify-content: center;
      background-color: light-dark(#ffffff, #1c1c1e);
    }

    .deck-button-label {
      color: light-dark(#3a3a3c, #d1d1d6);
      font-size: 15px;
      font-weight: 600;
    }

    .deck-done {
      padding: 24px 16px;
      align-items: center;
    }

    .accent {
      color: #dd0330;
    }

    .center {
      text-align: center;
    }

    .list-label {
      margin-bottom: -12px;
    }

    .episode-slot {
      padding: 0 16px;
    }

    .episode {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      border-bottom-width: 1px;
      border-bottom-color: light-dark(#e5e5ea, #38383a);
    }

    .episode-art {
      width: 52px;
      height: 52px;
      border-radius: 8px;
    }

    .episode-title {
      color: light-dark(#1c1c1e, #ffffff);
      font-size: 16px;
      font-weight: 500;
    }

    .play {
      width: 34px;
      height: 34px;
      border-radius: 17px;
      align-items: center;
      justify-content: center;
      background-color: light-dark(#fde7eb, #3a1219);
    }

    .play-on {
      background-color: #dd0330;
    }

    .footer {
      padding: 20px 16px 28px;
    }

    .letter {
      height: 32px;
      justify-content: center;
      padding: 0 16px;
      background-color: light-dark(#f2f2f7, #000000);
    }

    .letter-text {
      color: #dd0330;
      font-size: 15px;
      font-weight: 700;
    }

    .show {
      height: 64px;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      background-color: light-dark(#ffffff, #1c1c1e);
    }

    .show-art {
      width: 44px;
      height: 44px;
      border-radius: 22px;
    }

    .follow {
      width: 34px;
      height: 34px;
      border-radius: 17px;
      align-items: center;
      justify-content: center;
      border-width: 1.5px;
      border-color: #dd0330;
    }

    .follow-on {
      background-color: #dd0330;
    }

    .search-bar {
      padding: 8px 16px;
    }

    .search {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding: 0 12px;
      border-radius: 20px;
      background-color: light-dark(#e3e3e8, #1c1c1e);
    }

    .search-field {
      flex: 1;
      font-size: 16px;
      color: light-dark(#1c1c1e, #ffffff);
    }
  `,
})
export default class MoreComponentsPage {
  private readonly scheme = inject(ColorScheme);

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly rowHeight = ROW;
  protected readonly featured = EPISODES[0]!;
  protected readonly libraries: readonly { value: Library; label: string }[] = [
    { value: 'episodes', label: 'Episodes' },
    { value: 'shows', label: 'Shows' },
  ];

  protected readonly library = signal<Library>('episodes');
  protected readonly query = signal('');
  protected readonly playing = signal<string | null>(null);
  protected readonly followed = signal<ReadonlySet<string>>(new Set(['signal-hour']));
  protected readonly saved = signal<readonly Episode[]>([]);

  private readonly queue = signal<readonly Episode[]>(EPISODES.slice(1, 9));
  protected readonly next = computed(() => this.queue()[0]);

  protected readonly episodes = computed(() => searchEpisodes(this.query()));
  protected readonly shows = computed(() => showSections(this.query()));
  protected readonly episodesLabel = computed(() =>
    this.query() === ''
      ? `ALL EPISODES · ${this.episodes().length}`
      : `${this.episodes().length} RESULTS`,
  );
  protected readonly dockColor = computed(() =>
    this.scheme.current() === 'dark' ? '#000000' : '#f2f2f7',
  );

  private readonly drag = new Animated.Value(0);
  private readonly appear = new Animated.Value(1);
  protected readonly deckStyle = {
    opacity: this.appear,
    transform: [
      { translateX: this.drag },
      {
        rotate: this.drag.interpolate({
          inputRange: [-300, 0, 300],
          outputRange: ['-10deg', '0deg', '10deg'],
        }),
      },
    ],
  };
  protected readonly swipe = swipeGesture(this.drag, (direction) => this.send(direction));

  /** Sends the Up next card away: right saves it for later, left skips it. */
  protected send(direction: 1 | -1): void {
    const episode = this.next();
    if (!episode) return;
    Animated.timing(this.drag, {
      toValue: direction * 480,
      duration: 200,
      useNativeDriver: true,
    }).start(() => this.dealNext(episode, direction));
  }

  protected togglePlaying(episode: Episode): void {
    this.playing.update((id) => (id === episode.id ? null : episode.id));
  }

  protected toggleFollow(id: string): void {
    this.followed.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  private dealNext(episode: Episode, direction: 1 | -1): void {
    if (direction === 1) this.saved.update((saved) => [...saved, episode]);
    this.queue.update((queue) => queue.filter((queued) => queued !== episode));
    this.drag.setValue(0);
    this.appear.setValue(0);
    Animated.timing(this.appear, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }
}
