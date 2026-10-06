/**
 * Real screens rather than a synthetic list: a Signal Forms field being typed into, and a CSS
 * transition's frames among a thousand rows.
 *
 *     node --no-opt --no-sparkplug --no-maglev --import ./bench/release.mjs \
 *       --import ./register-linker.mjs bench/screens.bench.ts [typing|animation|scroll|feed]
 *     ROWS=200 ANIMATED=1,10 ...         the animation's size
 *     PROFILE=/tmp/p ...                 a .cpuprofile of the measured steps
 *
 * Each step is timed through a synchronous `tick`, so what is measured is change detection and
 * the commit, the same span a device spends between an event and the frame that shows it.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { fileURLToPath } from 'node:url';
import { Component, input, signal, type ApplicationRef, type Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from '../compile.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { VirtualList, VirtualListRow } from '../../components/src/virtual-list.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, name: string): never;
};

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);
const fixture = (name: string) =>
  compileFixture(fileURLToPath(new URL(`../fixtures/${name}.ts`, import.meta.url)));

const PROFILE = process.env['PROFILE'];
const profiler = PROFILE ? new Session() : null;
profiler?.connect();
profiler?.post('Profiler.enable');
profiler?.post('Profiler.setSamplingInterval', { interval: 50 });
let profiles = 0;

/** Time one step, profiling it alone when asked. */
function timed(name: string, step: () => void): number {
  profiler?.post('Profiler.start');
  const started = performance.now();
  step();
  const ms = performance.now() - started;
  profiler?.post('Profiler.stop', (error, result) => {
    if (!error)
      writeFileSync(`${PROFILE}/${name}-${profiles++}.cpuprofile`, JSON.stringify(result.profile));
  });
  return ms;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const report = (name: string, xs: number[]) =>
  console.log(
    `${name.padEnd(14)} median ${median(xs).toFixed(2).padStart(7)}ms  (${xs.length} runs)`,
  );

async function typing(): Promise<void> {
  const mod = await fixture('text-input-form');
  const fabric = createFakeFabric();
  const app = mount(1, mod['TextInputForm'] as Type<unknown>, fabric, {
    globalStyles: compileCss('.x {}', 'global'),
  });
  const appRef: ApplicationRef = app.applicationRef;
  appRef.tick();
  const field = () => {
    const host = flatten(fabric.committed).find((n) => n.props['nativeID'] === 'email')!;
    return flatten([host]).find((n) => /TextInput/.test(String(n.viewName)))!;
  };
  const keystrokes: number[] = [];
  let text = '';
  for (let i = 0; i < 60; i++) {
    text = i % 20 === 0 ? 'a' : text + 'a';
    const ms = timed('keystroke', () => {
      fabric.emit(field(), 'topChange', { text, eventCount: i + 1, target: 1 });
      appRef.tick();
    });
    if (i >= 10) keystrokes.push(ms);
  }
  report('keystroke', keystrokes);
}

/**
 * A CSS transition's frames, which run in JavaScript: every frame the engine advances each running
 * transition and commits. `ANIMATED` rows fade among a thousand that do not, so the cost of the
 * frame is measured with a realistic amount of screen around the animation.
 */
@Component({
  selector: 'x-fade-list',
  imports: [Text, View],
  template: `
    <view>
      @for (row of rows; track row) {
        <view class="row" [class.faded]="row < animated() && faded()"
          ><text>row {{ row }}</text></view
        >
      }
    </view>
  `,
  styles: `
    .row {
      opacity: 1;
      transition: opacity 300ms linear;
    }
    .row.faded {
      opacity: 0.2;
    }
  `,
})
class FadeList {
  readonly rows = Array.from({ length: Number(process.env['ROWS'] ?? 1000) }, (_, i) => i);
  readonly animated = signal(0);
  readonly faded = signal(false);
}

async function animation(): Promise<void> {
  let clock = 0;
  for (const animated of (process.env['ANIMATED'] ?? '1,10,100').split(',').map(Number)) {
    const fabric = createFakeFabric();
    const app = mount(1, FadeList, fabric, { now: () => clock });
    const list = app.componentRef.instance as FadeList;
    list.animated.set(animated);
    app.applicationRef.tick();
    const frames: number[] = [];
    for (let round = 0; round < 4; round++) {
      list.faded.set(!list.faded());
      app.applicationRef.tick();
      // Eighteen 16ms frames: the whole 300ms transition.
      for (let frame = 0; frame < 18; frame++) {
        clock += 16;
        const ms = timed('frame', () => {
          app.engine.advanceAnimations(clock);
          app.engine.commit();
        });
        if (round > 0) frames.push(ms);
      }
    }
    report(`frame, ${animated} fading`, frames);
  }
}

const ITEMS = Array.from({ length: 10000 }, (_, i) => ({ id: i, label: `row ${i}` }));

/** The idiom the docs show: a row per index, so a row that scrolls out is destroyed. */
@Component({
  selector: 'x-fling-by-index',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list #list [items]="items" [itemHeight]="44" [style]="fill">
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
class FlingByIndex {
  readonly items = ITEMS;
  readonly fill = { flex: 1 };
}

/** A row as an app draws one: an avatar, a title and subtitle, a badge and a button. */
@Component({
  selector: 'x-fling-rich',
  imports: [VirtualList, Pressable, Text, View],
  template: `
    <virtual-list #list [items]="items" [itemHeight]="72" [style]="fill">
      @for (row of list.window(); track row.index) {
        <view [style]="row.style">
          <view [style]="line">
            <view [style]="avatar"
              ><text>{{ row.index % 26 }}</text></view
            >
            <view [style]="body">
              <text [style]="title">{{ row.item.label }}</text>
              <text [style]="subtitle" [numberOfLines]="1">Subtitle for {{ row.item.label }}</text>
            </view>
            <view [style]="badge"
              ><text>{{ row.index % 9 }}</text></view
            >
            <pressable [style]="button" (press)="open(row.index)"><text>Open</text></pressable>
          </view>
        </view>
      }
    </virtual-list>
  `,
})
class FlingRich {
  readonly items = ITEMS;
  readonly fill = { flex: 1 };
  readonly line = { flexDirection: 'row', alignItems: 'center', padding: 12 };
  readonly avatar = { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ccc' };
  readonly body = { flex: 1, marginHorizontal: 12 };
  readonly title = { fontSize: 16, fontWeight: '600' };
  readonly subtitle = { fontSize: 13, color: '#666' };
  readonly badge = { paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#e33' };
  readonly button = { padding: 8, borderRadius: 6, backgroundColor: '#07f' };
  opened = -1;
  open(index: number): void {
    this.opened = index;
  }
}

/** The same rich rows, recycled by slot. */
@Component({
  selector: 'x-fling-rich-recycled',
  imports: [VirtualList, Pressable, Text, View],
  template: `
    <virtual-list #list [items]="items" [itemHeight]="72" [style]="fill">
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style">
          <view [style]="line">
            <view [style]="avatar"
              ><text>{{ row.index % 26 }}</text></view
            >
            <view [style]="body">
              <text [style]="title">{{ row.item.label }}</text>
              <text [style]="subtitle" [numberOfLines]="1">Subtitle for {{ row.item.label }}</text>
            </view>
            <view [style]="badge"
              ><text>{{ row.index % 9 }}</text></view
            >
            <pressable [style]="button" (press)="open(row.index)"><text>Open</text></pressable>
          </view>
        </view>
      }
    </virtual-list>
  `,
})
class FlingRichRecycled {
  readonly items = ITEMS;
  readonly fill = { flex: 1 };
  readonly line = { flexDirection: 'row', alignItems: 'center', padding: 12 };
  readonly avatar = { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ccc' };
  readonly body = { flex: 1, marginHorizontal: 12 };
  readonly title = { fontSize: 16, fontWeight: '600' };
  readonly subtitle = { fontSize: 13, color: '#666' };
  readonly badge = { paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#e33' };
  readonly button = { padding: 8, borderRadius: 6, backgroundColor: '#07f' };
  opened = -1;
  open(index: number): void {
    this.opened = index;
  }
}

/**
 * A fast fling: one scroll event a frame, 60 points each (about 3700 points a second), over a
 * ten-thousand-row list whose viewport is a phone's height.
 */
async function scroll(): Promise<void> {
  for (const [name, type] of [
    ['by index', FlingByIndex],
    ['rich rows', FlingRich],
    ['rich, slot', FlingRichRecycled],
  ] as const) {
    const fabric = createFakeFabric();
    const app = mount(1, type, fabric);
    app.applicationRef.tick();
    const found = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    const list = () => found;
    fabric.emit(list(), 'topLayout', { layout: { width: 390, height: 844 } });
    app.applicationRef.tick();
    const frames: number[] = [];
    const createdBefore = fabric.calls.createNode;
    let y = 0;
    for (let frame = 0; frame < 400; frame++) {
      y += 60;
      const ms = timed(`scroll-${name.replace(' ', '-')}`, () => {
        fabric.emit(list(), 'topScroll', { contentOffset: { x: 0, y } });
        app.applicationRef.tick();
      });
      if (frame >= 20) frames.push(ms);
    }
    const sorted = [...frames].sort((a, b) => a - b);
    report(`fling, ${name}`, frames);
    console.log(
      `${''.padEnd(14)} nodes created during the fling: ${fabric.calls.createNode - createdBefore}`,
    );
    console.log(
      `${''.padEnd(14)} p95    ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(2).padStart(7)}ms`,
    );
  }
}

interface Post {
  readonly id: string;
  readonly kind: 'text' | 'photo';
  readonly author: string;
  readonly body: string;
  readonly likes: number;
}

const POSTS: readonly Post[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `p${i}`,
  kind: i % 3 === 0 ? 'photo' : 'text',
  author: `Author ${i % 40}`,
  body: `Post ${i} `.repeat(1 + (i % 5)),
  likes: (i * 37) % 500,
}));

/** A feed: rows that size themselves, of two kinds, keyed, with a pool per kind. */
@Component({
  selector: 'x-fling-feed',
  imports: [VirtualList, VirtualListRow, Pressable, Text, View],
  template: `
    <virtual-list
      #list
      [items]="items"
      [estimatedItemHeight]="estimate"
      [keyExtractor]="idOf"
      [itemType]="kindOf"
      [style]="fill"
    >
      @for (row of list.window(); track row.slot) {
        <view [virtualListRow]="row" [nativeID]="'row-' + row.key">
          <view [style]="line">
            <view [style]="avatar"></view>
            <text [style]="title">{{ row.item.author }}</text>
          </view>
          <text [style]="bodyText">{{ row.item.body }}</text>
          @if (row.item.kind === 'photo') {
            <view [style]="photo"></view>
          }
          <view [style]="line">
            <pressable [style]="button"
              ><text>Like {{ row.item.likes }}</text></pressable
            >
            <pressable [style]="button"><text>Share</text></pressable>
          </view>
        </view>
      }
    </virtual-list>
  `,
})
class FlingFeed {
  readonly items = POSTS;
  readonly fill = { flex: 1 };
  readonly line = { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 };
  readonly avatar = { width: 32, height: 32, borderRadius: 16, backgroundColor: '#ccc' };
  readonly title = { fontSize: 15, fontWeight: '600' };
  readonly bodyText = { fontSize: 15, paddingHorizontal: 8 };
  readonly photo = { height: 240, backgroundColor: '#ddd' };
  readonly button = { padding: 6 };
  readonly estimate = (post: Post) => (post.kind === 'photo' ? 380 : 140);
  readonly idOf = (post: Post) => post.id;
  readonly kindOf = (post: Post) => post.kind;
}

/** The height native would lay a post out at: not the estimate, as in a real feed. */
const heightOf = (index: number) => (POSTS[index]!.kind === 'photo' ? 360 : 110) + 20 * (index % 5);

/**
 * The feed flung at the same speed. A row that mounts reports its layout, as native does after
 * the commit that mounted it; that pass is timed too, since it is on the JavaScript thread in the
 * same frames, and the two are reported apart and together.
 */
async function feed(): Promise<void> {
  const fabric = createFakeFabric();
  const app = mount(1, FlingFeed, fabric);
  app.applicationRef.tick();
  const list = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
  fabric.emit(list, 'topLayout', { layout: { width: 390, height: 844 } });
  app.applicationRef.tick();
  const measured = new Set<string>();
  /** Report every row on screen that has not reported yet, as native would. */
  const layOut = () => {
    let reported = 0;
    for (const node of flatten(fabric.committed)) {
      const id = node.props['nativeID'];
      if (typeof id !== 'string' || !id.startsWith('row-p') || node.props['opacity'] === 0)
        continue;
      if (measured.has(id)) continue;
      measured.add(id);
      fabric.emit(node, 'topLayout', {
        layout: { width: 390, height: heightOf(Number(id.slice(5))) },
      });
      reported++;
    }
    if (reported) app.applicationRef.tick();
  };
  layOut();
  const scrolls: number[] = [];
  const layouts: number[] = [];
  const frames: number[] = [];
  const createdBefore = fabric.calls.createNode;
  let y = 0;
  for (let frame = 0; frame < 400; frame++) {
    y += 60;
    const scrolled = timed('feed-scroll', () => {
      fabric.emit(list, 'topScroll', { contentOffset: { x: 0, y } });
      app.applicationRef.tick();
    });
    const laidOut = timed('feed-layout', layOut);
    if (frame >= 20) {
      scrolls.push(scrolled);
      layouts.push(laidOut);
      frames.push(scrolled + laidOut);
    }
  }
  const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
  report('feed, scroll', scrolls);
  report('feed, layouts', layouts);
  report('feed, frame', frames);
  console.log(`${''.padEnd(14)} p95    ${p95(frames).toFixed(2).padStart(7)}ms per frame`);
  console.log(
    `${''.padEnd(14)} worst  ${Math.max(...frames)
      .toFixed(2)
      .padStart(7)}ms`,
  );
  console.log(
    `${''.padEnd(14)} nodes created during the fling: ${fabric.calls.createNode - createdBefore}`,
  );
  // That it moved at all: the rows on screen at the end, for a fling of `y` points.
  const shown = flatten(fabric.committed)
    .map((node) => node.props['nativeID'])
    .filter((id): id is string => typeof id === 'string' && id.startsWith('row-p'));
  console.log(`${''.padEnd(14)} at ${y} points, rows ${shown.slice(0, 3).join(' ')}...`);
}

/**
 * A scroll handler on a screen with a long list in its template: the header fades as the page
 * scrolls, which is the commonest thing a `(scroll)` binding does.
 */
@Component({
  selector: 'x-scroll-handler',
  imports: [ScrollView, Text, View],
  template: `
    <scroll-view (scroll)="scrolled($event)">
      <view [style]="{ opacity: headerOpacity() }"><text>Header</text></view>
      @for (row of rows; track row) {
        <view
          ><text>row {{ row }}</text></view
        >
      }
    </scroll-view>
  `,
})
class ScrollHandler {
  readonly rows = Array.from({ length: Number(process.env['ROWS'] ?? 1000) }, (_, i) => i);
  readonly headerOpacity = signal(1);
  scrolled(event: { nativeEvent?: { contentOffset?: { y?: number } } }): void {
    const y = event.nativeEvent?.contentOffset?.y ?? 0;
    this.headerOpacity.set(Math.max(0, 1 - y / 200));
  }
}

/** The same list in a component of its own, so refreshing the screen checks one input. */
@Component({
  selector: 'x-rows',
  imports: [Text, View],
  template: `
    @for (row of rows(); track row) {
      <view
        ><text>row {{ row }}</text></view
      >
    }
  `,
})
class Rows {
  readonly rows = input.required<readonly number[]>();
}

@Component({
  selector: 'x-scroll-handler-split',
  imports: [Rows, ScrollView, Text, View],
  template: `
    <scroll-view (scroll)="scrolled($event)">
      <view [style]="{ opacity: headerOpacity() }"><text>Header</text></view>
      <x-rows [rows]="rows" />
    </scroll-view>
  `,
})
class ScrollHandlerSplit extends ScrollHandler {}

/** Each scroll event on that screen: the handler, change detection and the commit. */
async function scrollEvents(): Promise<void> {
  const which = process.env['ONLY'];
  for (const [name, type] of [
    ['list inline', ScrollHandler],
    ['list split', ScrollHandlerSplit],
  ] as const) {
    if (which && !name.includes(which)) continue;
    await scrollEventsOn(name, type);
  }
}

async function scrollEventsOn(name: string, type: Type<unknown>): Promise<void> {
  const fabric = createFakeFabric();
  const app = mount(1, type, fabric);
  app.applicationRef.tick();
  // Found once: a node found again later is a clone with the same instance handle, and the
  // lookup walks the whole committed tree, which is not what is being timed.
  const target = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
  const scroller = () => target;
  const events: number[] = [];
  for (let i = 0; i < 120; i++) {
    const ms = timed('scroll-event', () => {
      fabric.emit(scroller(), 'topScroll', { contentOffset: { x: 0, y: i * 2 } });
      app.applicationRef.tick();
    });
    if (i >= 20) events.push(ms);
  }
  report(`scroll, ${name}`, events);
}

const SCREENS: Record<string, () => Promise<void>> = {
  typing,
  animation,
  scroll,
  feed,
  'scroll-events': scrollEvents,
};
const only = process.argv.slice(2);
// After this module has finished evaluating: the compiler attaches `FadeList`'s stylesheet at
// the end of it. See `renderer.bench.ts`.
setTimeout(async () => {
  for (const name of only.length ? only : Object.keys(SCREENS)) await SCREENS[name]!();
  // The engine keeps a frame scheduled while anything animates, and the clock here never catches
  // up with the transitions it starts, so the process would otherwise never exit.
  process.exit(0);
});
