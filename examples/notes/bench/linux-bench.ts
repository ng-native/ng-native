// The workload `pnpm bench:linux` measures beside the notes example (scripts/bench-linux.mjs): a
// release bundle of its own, exported from this folder with the notes example's Metro config, that
// is not part of the notes app. It opens four more windows (and closes them), mounts a list of
// 2,000 views, scrolls it while one view changes a frame, drags a divider by changing a width
// each frame, and plays a CSS animation on a grid of views, telling the
// bench's local server when each step begins and ends so it can read what the host logged in
// between (the commits and frames, NGN_LOG_COMMITS) and the process's memory. A step that did not
// do what it measures (the list did not reach its height, the window did not open) says so, and
// the server reads it as no measurement.
import 'expo';
import { Component, inject, signal, viewChild } from '@angular/core';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { ScrollView, Text, View } from '@ng-native/components';
import { AppWindows, type AppWindow } from '@ng-native/device';
import { getFabricUIManager, nextFrame, registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';

/** The bench's server, which the bench script listens on in the same container. */
const SERVER = 'http://127.0.0.1:51741';
const ROWS = 2000;
const ROW_HEIGHT = 24;
const FRAMES = 120;
/** How many windows the window step opens: one window's memory is small beside a process's noise. */
const EXTRA_WINDOWS = 4;
/** How many views the animation step turns and fades. */
const SPINNERS = 200;
/** How long the animation step watches the animation play. */
const ANIMATE_MS = 2000;

const tell = (path: string): Promise<unknown> => fetch(`${SERVER}/${path}`).then((r) => r.text());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The second window: a label, as little as a window can hold. */
@Component({
  selector: 'bench-window',
  imports: [Text, View],
  template: `<view style="flex: 1; padding: 16px"><text>Second window</text></view>`,
})
class BenchWindow {}

@Component({
  selector: 'bench-root',
  imports: [ScrollView, View],
  styles: `
    .spinners {
      position: absolute;
      top: 0;
      left: 0;
      width: 400px;
      flex-direction: row;
      flex-wrap: wrap;
    }
    .spinner {
      width: 16px;
      height: 16px;
      margin: 2px;
      background-color: #3366cc;
    }
    .spinning {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from {
        transform: rotate(0deg);
        opacity: 1;
      }
      to {
        transform: rotate(360deg);
        opacity: 0.4;
      }
    }
  `,
  template: `
    <view style="flex: 1; flex-direction: row">
      <view [style]="{ width: divider(), backgroundColor: '#dddddd' }"></view>
      <scroll-view style="flex: 1" (contentSizeChange)="contentHeight.set($event.height)">
        @for (row of rows(); track row) {
          <view
            [style]="{
              height: rowHeight,
              backgroundColor: row === changing() ? '#cc0000' : '#888888',
            }"
          ></view>
        }
      </scroll-view>
      <view class="spinners">
        @for (spinner of spinners(); track spinner) {
          <view class="spinner" [class.spinning]="spinning()"></view>
        }
      </view>
    </view>
  `,
})
class BenchRoot {
  private readonly windows = inject(AppWindows);
  private readonly list = viewChild.required(ScrollView);

  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly rows = signal<number[]>([]);
  /** The row that changes each frame while the list scrolls. */
  protected readonly changing = signal(-1);
  /** The width of the strip a drag would resize. */
  protected readonly divider = signal(200);
  /** The views the animation step plays an animation on, and whether it plays. */
  protected readonly spinners = signal<number[]>([]);
  protected readonly spinning = signal(false);
  /** What the list's content measures, which reaches the rows' height once they are mounted. */
  protected readonly contentHeight = signal(0);

  constructor() {
    void this.run();
  }

  private async run(): Promise<void> {
    await tell('start');
    // First, before the steps that leave garbage behind, so the memory it reads moves with the windows.
    const opened: AppWindow[] = [];
    await tell(`count/${EXTRA_WINDOWS}`);
    await this.step('window', async () => {
      for (let index = 0; index < EXTRA_WINDOWS; index += 1) {
        const next = await this.windows.open(BenchWindow, {
          title: `Window ${index + 2}`,
          width: 400,
          height: 300,
        });
        if (next) opened.push(next);
      }
      await nextFrame();
      return opened.length === EXTRA_WINDOWS;
    });
    await Promise.all(opened.map((window) => window.close()));
    await this.step('mount', async () => {
      this.rows.set(Array.from({ length: ROWS }, (_, row) => row));
      return this.until(() => this.contentHeight() >= ROWS * ROW_HEIGHT);
    });
    await this.step('scroll', async () => {
      for (let frame = 0; frame < FRAMES; frame += 1) {
        this.changing.set(frame % ROWS);
        this.list().scrollTo({ y: frame * ROW_HEIGHT, animated: false });
        await nextFrame();
      }
      return true;
    });
    await this.step('resize', async () => {
      for (let frame = 0; frame < FRAMES; frame += 1) {
        this.divider.set(200 + frame);
        await nextFrame();
      }
      return true;
    });
    // Mounted before the step, which measures the animation and not the views it plays on.
    this.spinners.set(Array.from({ length: SPINNERS }, (_, spinner) => spinner));
    await nextFrame();
    await this.step('animate', async () => {
      this.spinning.set(true);
      await sleep(ANIMATE_MS);
      return true;
    });
    this.spinning.set(false);
    await tell('done');
  }

  /**
   * `begin` and `end` bracket the step for the server, which lets the host's output catch up first;
   * `failed` ends it when it did not do what it measures.
   */
  private async step(name: string, body: () => Promise<boolean>): Promise<void> {
    await tell(`begin/${name}`);
    const worked = await body();
    await sleep(500);
    await tell(`${worked ? 'end' : 'failed'}/${name}`);
  }

  /** Whether `condition` held within five seconds of frames. */
  private async until(condition: () => boolean): Promise<boolean> {
    for (let waited = 0; waited < 5000 && !condition(); waited += 16) await sleep(16);
    return condition();
  }
}

registerPlatformComponents(Platform.OS);

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  mount(Number(rootTag), BenchRoot, getFabricUIManager(), {
    processColor,
    resolveAssetSource: (value) => Image.resolveAssetSource(value as never),
  });
});
