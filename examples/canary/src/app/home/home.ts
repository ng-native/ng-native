import { Component } from '@angular/core';
import { Pressable, ScrollView, Text } from '@ng-native/components';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * What `ngDevMode` currently is, in the three states that matter.
 *
 * Angular sets it to an object of perf counters in development, which is what `on` means here and
 * is correct there. `off` is the release build, and is the preset's polyfill having done its job.
 * `unset` is the one to worry about: Angular treats an undefined `ngDevMode` as development, so a
 * release build saying that is running every assertion and check it has.
 */
function devModeState(): string {
  if (typeof ngDevMode === 'undefined') return 'unset - this build is running dev checks';
  return ngDevMode ? 'on' : 'off';
}

interface Feature {
  path: string;
  title: string;
  blurb: string;
}

/**
 * The feature index. Every example lives on its own screen so a bug can be reproduced in
 * isolation, and so pushing and popping exercises the native stack on every visit.
 */
@Component({
  selector: 'x-home',
  imports: [NativeHeader, Pressable, ScrollView, NativeRouterLink, Text],
  template: `
    <native-header title="Angular Native" [largeTitle]="true" />
    <scroll-view
      class="screen"
      contentInsetAdjustmentBehavior="automatic"
      [contentContainerStyle]="page.content"
    >
      <text class="hint">
        Real native views, no React in the render path. Pick a feature to exercise it.
      </text>

      @for (feature of features; track feature.path) {
        <pressable class="card" [nativeRouterLink]="feature.path">
          <text class="button-label">{{ feature.title }}</text>
          <text class="hint">{{ feature.blurb }}</text>
        </pressable>
      }

      <text class="hint">{{ build }}</text>
    </scroll-view>
  `,
})
export class Home {
  protected readonly page = page;

  /**
   * What kind of build this is, which is only interesting because it is invisible otherwise.
   *
   * `ngDevMode` is the one that matters: Angular treats it as *undefined meaning dev* and installs
   * its counters, and nothing in a Metro pipeline replaces the identifier the way the Angular CLI
   * does, so a release build that has not been told is a release build running every assertion.
   * An object here means that happened; `false` means the preset's polyfill did its job.
   *
   * The number beside it is how long after the bundle started this page was constructed, which is
   * the part of startup this project can actually affect: everything before it is native, and
   * React Native's own `performance.now()` has no app-start origin to measure against.
   */
  protected readonly build = [
    `${__DEV__ ? 'dev' : 'release'} build`,
    `ngDevMode ${devModeState()}`,
    `first screen ${Date.now() - ((globalThis as { __started?: number }).__started ?? Date.now())}ms after the bundle started`,
  ].join(', ');

  protected readonly features: Feature[] = [
    {
      path: '/spartan',
      title: 'Spartan UI',
      blurb: 'a web component library on the engine through web-compat, one component at a time',
    },
    {
      path: '/feed',
      title: 'Feed',
      blurb: 'self-sizing posts, galleries, paging, refresh, optimistic likes',
    },
    {
      path: '/chat',
      title: 'Chat',
      blurb: 'inverted transcript, composer on the keyboard, retries, history',
    },
    {
      path: '/world',
      title: 'Everywhere',
      blurb:
        'plurals with six forms, right-to-left cards, hard scripts, a screen reader, reduced motion',
    },
    {
      path: '/notes',
      title: 'Notes',
      blurb: 'a block editor: markdown shortcuts, lists that carry on, a toolbar on the keyboard',
    },
    {
      path: '/stories',
      title: 'Stories',
      blurb:
        'progress bars on keyframes that advance on animationend, hold to pause, swipe to close',
    },
    {
      path: '/shop',
      title: 'Shop',
      blurb: 'a product grid in CSS, sale prices struck through, sizes, a basket with steppers',
    },
    {
      path: '/settings',
      title: 'Settings',
      blurb:
        'grouped rows, tiles, switches, search, an appearance picker that themes the whole app',
    },
    {
      path: '/wallet',
      title: 'Wallet',
      blurb:
        'a hero played by the scroll on the native side, staggered bars, money in four currencies',
    },
    {
      path: '/calendar',
      title: 'Calendar',
      blurb: 'a month grid, a day timeline placed by CSS arithmetic, events drawn by dragging',
    },
    {
      path: '/kanban',
      title: 'Kanban',
      blurb: 'columns side by side, cards dragged between them, themed by relative colours',
    },
    {
      path: '/ride',
      title: 'Ride',
      blurb: 'a live map under a sheet with detents, search in it, fares, a driver on the way',
    },
    {
      path: '/player',
      title: 'Player',
      blurb:
        'covers drawn in CSS, keyframe equalisers, a page-sheet player with a hand-made scrubber',
    },
    {
      path: '/browse',
      title: 'Browse',
      blurb: 'shelves of horizontal lists, pinned headings, jumps, pull to refresh',
    },
    {
      path: '/inbox',
      title: 'Mail',
      blurb: 'rows that swipe inside a list inside a pager, tap, press and hold',
    },
    {
      path: '/orders',
      title: 'Orders',
      blurb: 'live status polled while in view, switched and cancelled mid-request',
    },
    {
      path: '/field-notes',
      title: 'Field notes',
      blurb: 'offline first: an outbox that survives restarts, retries and conflicts',
    },
    {
      path: '/stress',
      title: 'Stress list',
      blurb: 'ten thousand rows with images, live prices, filtering, and a cost readout',
    },
    {
      path: '/overlays',
      title: 'Overlays',
      blurb: 'a toast and a loading cover above every screen and sheet',
    },
    {
      path: '/account',
      title: 'Account',
      blurb: 'sign in with a code, then a session that expires from inside a sheet',
    },
    {
      path: '/photos',
      title: 'Photo viewer',
      blurb: 'swipe between photos, pinch and double-tap to zoom, swipe down to close',
    },
    {
      path: '/queue',
      title: 'Queue',
      blurb: 'inserts, deletes, moves between sections, sorts, bursts of changes',
    },
    {
      path: '/search-demo',
      title: 'Search',
      blurb: 'native search bar, live and debounced search, recents, scopes',
    },
    {
      path: '/projects',
      title: 'Task manager',
      blurb: 'master-detail editing, sheets, deep stacks, deep links',
    },
    {
      path: '/keyboard',
      title: 'Keyboard lab',
      blurb: 'bottom fields, carousels, keyboard types, a dock, a sheet',
    },
    {
      path: '/application',
      title: 'Application form',
      blurb: 'twenty-odd fields, pickers, async checks, rules between fields',
    },
    { path: '/primitives', title: 'Primitives', blurb: 'switch, text input, image, spinner' },
    {
      path: '/components',
      title: 'Components',
      blurb: 'presses, a refused switch, input events, modal events',
    },
    { path: '/text', title: 'Text nesting', blurb: 'spans, inheritance, baselines' },
    { path: '/css', title: 'CSS', blurb: 'selectors, specificity, cascade, inheritance' },
    { path: '/tailwind', title: 'Tailwind', blurb: 'utilities that combine, as Chrome draws them' },
    { path: '/layout', title: 'Layout', blurb: 'flexbox through Yoga, and its native defaults' },
    { path: '/typography', title: 'Typography', blurb: 'real text nodes, nesting, truncation' },
    { path: '/surfaces', title: 'Surfaces', blurb: 'borders, corners, shadows, transforms' },
    { path: '/scrolling', title: 'Scrolling', blurb: 'horizontal, paging, offsets, under load' },
    { path: '/verify', title: 'Verify', blurb: 'the features that fail silently, shown on screen' },
    {
      path: '/css-engine',
      title: 'CSS engine',
      blurb: 'units, tokens, media queries, transitions, keyframes',
    },
    {
      path: '/expo-ui',
      title: 'SwiftUI controls',
      blurb: '@expo/ui views, driven by the engine rather than React',
    },
    {
      path: '/native-views',
      title: 'Native views',
      blurb: 'Liquid Glass, SF Symbols and Sign in with Apple',
    },
    { path: '/forms', title: 'Signal forms', blurb: 'binding and validation over native controls' },
    { path: '/gestures', title: 'Gestures', blurb: 'responder system, capture, scroll blocking' },
    { path: '/list', title: 'Virtual list', blurb: '1000 rows, mixed heights, commit stats' },
    { path: '/modal', title: 'Modal', blurb: 'native presentation' },
    {
      path: '/regressions',
      title: 'Stress regressions',
      blurb: 'headers, same-route pushes, modals, failing pages, text size',
    },
    {
      path: '/navigation',
      title: 'Navigation',
      blurb: 'push, replace, sheets, reset',
    },
    { path: '/header', title: 'Navigation bar', blurb: 'inline and large titles, action items' },
    { path: '/animation', title: 'Animation', blurb: 'native driver, with the JS thread blocked' },
    { path: '/tabs', title: 'Tabs', blurb: 'a native tab bar, one tab with its own stack' },
    { path: '/icons', title: 'Icons', blurb: 'ng-icons, drawn as native svg shapes' },
    {
      path: '/device',
      title: 'Device',
      blurb: 'keyboard, screen, theme, app state, a11y settings',
    },
    { path: '/worklets', title: 'Worklets', blurb: 'reanimated, on the UI thread' },
    {
      path: '/native-gestures',
      title: 'Native gestures',
      blurb: 'a pan on the UI thread, and a tap on this one',
    },
    { path: '/expo', title: 'Expo modules', blurb: 'haptics, clipboard, files, and an Expo view' },
    { path: '/maps', title: 'Maps', blurb: 'expo-maps, with markers and a camera move' },
    {
      path: '/language-model',
      title: 'On-device AI',
      blurb: 'a prompt, and the answer streamed from the model on the phone',
    },
    {
      path: '/dom-components',
      title: 'DOM components',
      blurb: 'an Angular component for the browser, in a web view',
    },
  ];
}
