// The workload `pnpm bench:linux` measures beside the notes example (scripts/bench-linux.mjs): a
// release bundle of its own, exported from this folder with the notes example's Metro config, that
// is not part of the notes app. It mounts a list of 2,000 views, scrolls it while one view changes
// a frame, drags a divider by changing a width each frame, and opens a second window, telling the
// bench's local server when each step begins and ends so it can read what the host logged in
// between (the commits and frames, NGN_LOG_COMMITS) and the process's memory. A step that did not
// do what it measures (the list did not reach its height, the window did not open) says so, and
// the server reads it as no measurement.
import 'expo';
import { Component, inject, signal, viewChild } from '@angular/core';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { ScrollView, Text, View } from '@ng-native/components';
import { AppWindows } from '@ng-native/device';
import { getFabricUIManager, nextFrame, registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';

/** The bench's server, which the bench script listens on in the same container. */
const SERVER = 'http://127.0.0.1:51741';
const ROWS = 2000;
const ROW_HEIGHT = 24;
const FRAMES = 120;

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
  /** What the list's content measures, which reaches the rows' height once they are mounted. */
  protected readonly contentHeight = signal(0);

  constructor() {
    void this.run();
  }

  private async run(): Promise<void> {
    await tell('start');
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
    await this.step('window', async () => {
      const opened = await this.windows.open(BenchWindow, {
        title: 'Second window',
        width: 400,
        height: 300,
      });
      await nextFrame();
      return opened !== null;
    });
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
