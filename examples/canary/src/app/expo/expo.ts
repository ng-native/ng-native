import { Component, inject, signal } from '@angular/core';
import { Image } from 'react-native';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { ExpoImage } from '@ng-native/expo';
import { Clipboard } from '@ng-native/expo/clipboard';
import { FileSystem } from '@ng-native/expo/file-system';
import { Haptics } from '@ng-native/expo/haptics';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * Expo's native side, with none of Expo's React.
 *
 * Every module is injected, and none of them is provided anywhere: the services declare their own
 * factory, so importing one is the whole setup. Nothing in this file names Expo except the import
 * paths, which is the point - the app asks for a clipboard, not for a package.
 *
 * The view is the exception, and has to be. `<expo-image>` is a Fabric component registered by
 * name in `main.ts`; its props are the ones expo-image's React component would have passed down,
 * which is why `source` is an array.
 */
@Component({
  selector: 'x-expo',
  imports: [ExpoImage, NativeHeader, Pressable, ScrollView, Text, View],
  // Views registered by name, with no component behind them: see registerExpoView.
  template: `
    <native-header title="Expo modules" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        Expo's native modules as injectable services. React is in the bundle, because react-native
        imports it; it is never in the render path.
      </text>

      <text class="heading">expo-image</text>
      <text class="body">A Fabric view, registered by name and driven by the engine.</text>
      <expo-image
        [source]="remote"
        contentFit="cover"
        [transition]="{ duration: 400 }"
        class="image"
      />
      <expo-image [source]="local" contentFit="contain" class="image" />

      <text class="heading">Clipboard</text>
      <text class="body">{{ status() }}</text>
      <text class="hint">The pasteboard has changed {{ changes() }} times.</text>
      <view [style]="page.row">
        <pressable class="card" [style]="grow" (press)="copy()">
          <text class="button-label">Copy</text>
        </pressable>
        <pressable class="card" [style]="grow" (press)="paste()">
          <text class="button-label">Paste</text>
        </pressable>
      </view>
      <text class="hint">
        The count is a signal over an Expo EventEmitter. Reading is a separate call because on iOS
        16 and later it is what prompts the user for permission.
      </text>

      <text class="heading">File system</text>
      <text class="body">{{ file() }}</text>
      <pressable class="button" (press)="writeFile()">
        <text class="button-label">Write and read back</text>
      </pressable>

      <text class="heading">Haptics</text>
      <pressable class="button" (press)="tap()">
        <text class="button-label">{{ haptics.available ? 'Impact' : 'Not installed' }}</text>
      </pressable>
      <text class="hint">
        Fire and forget, and silent on a simulator, which has no Taptic Engine.
      </text>
    </scroll-view>
  `,
  styles: `
    .image {
      height: 160px;
      border-radius: 12px;
      background-color: var(--card);
    }
  `,
})
export class ExpoPage {
  protected readonly haptics = inject(Haptics);
  private readonly clipboard = inject(Clipboard);
  private readonly files = inject(FileSystem);

  protected readonly page = page;
  protected readonly grow = { flex: 1 };

  /** Native takes a list of candidates, so both spellings are one. */
  protected readonly remote = [{ uri: 'https://picsum.photos/seed/angular-native/900/500' }];
  /** A `require()`d asset is an id until something resolves it; expo-image wants it resolved. */
  protected readonly local = [
    Image.resolveAssetSource(require('../../../assets/local.png')),
  ].filter((source) => source !== undefined);

  protected readonly changes = this.clipboard.changes;
  protected readonly status = signal('Nothing copied yet.');
  protected readonly file = signal('No file written yet.');

  protected copy(): void {
    const stamp = `Angular Native at ${new Date().toLocaleTimeString()}`;
    void this.clipboard.write(stamp).then(() => this.status.set(`Copied: ${stamp}`));
  }

  protected paste(): void {
    void this.clipboard
      .read()
      .then((text) => this.status.set(text ? `Pasted: ${text}` : 'The clipboard is empty.'));
  }

  protected writeFile(): void {
    const target = this.files.cache('canary.txt');
    this.files.write(target, `written at ${new Date().toISOString()}`);
    this.file.set(`${target.textSync()} (${target.size} bytes)`);
  }

  protected tap(): void {
    this.haptics.impact();
  }
}
