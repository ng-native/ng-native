import { Component, inject, input, signal } from '@angular/core';
import { Image, NativeButton, ScrollView, Text, View } from '@ng-native/components';
import { Processes, Shell } from '@ng-native/device';
import { AppInfo } from '@ng-native/expo/app-info';
import { Crypto, CryptoDigestAlgorithm } from '@ng-native/expo/crypto';
import { FileSystem, type FolderName } from '@ng-native/expo/file-system';
import { Fonts } from '@ng-native/expo/fonts';
import { FlipType, ImageEditor, SaveFormat } from '@ng-native/expo/image-editor';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { Locale } from '@ng-native/expo/locale';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

const FOLDERS: readonly FolderName[] = [
  'appData',
  'document',
  'cache',
  'temp',
  'home',
  'desktop',
  'downloads',
];

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A desktop app's system access: the folders FileSystem names, a watch on the documents folder
 * while a file there is written twice and removed, KeepAwake's hold, and Shell opening a file
 * and showing it in its folder; then what the device modules answer. Each step logs on screen and
 * to the console as `[system] ...`; a launch link, `canary://desktop-system?run=watch` (or
 * `shell`, `awake`, `modules`, `media`), runs one. `media` loads a system font file under a name
 * of its own and turns, flips and shrinks an image with ImageEditor.
 */
@Component({
  selector: 'x-system',
  imports: [Image, NativeButton, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header title="System" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="heading">Folders</text>
      @for (folder of folders; track folder) {
        <text class="system-row">{{ folder }}: {{ files.paths[folder] ?? 'absent' }}</text>
      }
      <text class="heading">Available</text>
      <text class="system-row">
        Shell {{ shell.available() }}, Processes {{ processes.available() }}, KeepAwake
        {{ keepAwake.available() }}, awake {{ keepAwake.active() }}
      </text>
      <view class="system-buttons">
        <native-button (press)="runWatch()">Watch</native-button>
        <native-button (press)="runShell()">Shell</native-button>
        <native-button (press)="runAwake()">Keep awake</native-button>
        <native-button (press)="runModules()">Modules</native-button>
        <native-button (press)="runMedia()">Media</native-button>
      </view>
      <text class="heading">Device modules</text>
      @for (row of modules(); track row) {
        <text class="system-row">{{ row }}</text>
      }
      @if (fontLoaded()) {
        <text class="system-sample">CanaryMono: iiii mmmm 0123</text>
        <text class="system-row">The system font: iiii mmmm 0123</text>
      }
      @if (edited(); as edited) {
        <image class="system-image" [source]="{ uri: edited }" />
      }
      <text class="heading">Log</text>
      @for (line of log(); track $index) {
        <text class="system-row">{{ line }}</text>
      }
    </scroll-view>
  `,
  styles: `
    .system-row {
      font-size: 13px;
      margin-bottom: 4px;
    }
    .system-sample {
      font-family: CanaryMono;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .system-image {
      width: 120px;
      height: 60px;
      margin: 8px 0;
    }
    .system-buttons {
      flex-direction: row;
      gap: 12px;
      margin: 12px 0;
    }
  `,
})
export class SystemPage {
  readonly run = input<string>();
  protected readonly files = inject(FileSystem);
  protected readonly shell = inject(Shell);
  protected readonly processes = inject(Processes);
  protected readonly keepAwake = inject(KeepAwake);
  private readonly appInfo = inject(AppInfo);
  private readonly crypto = inject(Crypto);
  private readonly locale = inject(Locale);
  private readonly fonts = inject(Fonts);
  private readonly editor = inject(ImageEditor);
  protected readonly folders = FOLDERS;
  protected readonly page = page;
  protected readonly log = signal<readonly string[]>([]);
  protected readonly modules = signal<readonly string[]>([]);
  protected readonly fontLoaded = signal(false);
  protected readonly edited = signal<string | null>(null);

  constructor() {
    queueMicrotask(() => {
      const run = this.run();
      if (run === 'watch') void this.runWatch();
      if (run === 'shell') void this.runShell();
      if (run === 'awake') void this.runAwake();
      if (run === 'modules') void this.runModules();
      if (run === 'media') void this.runMedia();
    });
  }

  protected note(line: string): void {
    console.log(`[system] ${line}`);
    this.log.update((lines) => [...lines, line]);
  }

  protected async runWatch(): Promise<void> {
    const folder = this.files.paths.document;
    if (!folder) return this.note('no documents folder');
    const stop = this.files.watch(folder, (change) =>
      this.note(
        `${change.type} ${tail(change.uri)}${change.newUri ? ` to ${tail(change.newUri)}` : ''}`,
      ),
    );
    await wait(300);
    const first = this.files.document('watched.txt');
    first.write('one');
    await wait(400);
    first.write('two');
    await wait(400);
    first.delete();
    await wait(400);
    stop();
    this.note('watch stopped');
  }

  protected async runShell(): Promise<void> {
    const folder = this.files.paths.document;
    if (!folder) return this.note('no documents folder');
    const file = this.files.document('opened.txt');
    file.write('Opened by Shell.\n');
    const path = decodeURI(file.uri.replace(/^file:\/\//, ''));
    this.note(`showItemInFolder ${await this.shell.showItemInFolder(path)}`);
    this.note(`openPath ${await this.shell.openPath(path)}`);
  }

  protected async runAwake(): Promise<void> {
    const release = this.keepAwake.hold('canary');
    this.note(`held, active ${this.keepAwake.active()}`);
    await wait(1000);
    release();
    this.note(`released, active ${this.keepAwake.active()}`);
  }

  /** What AppInfo, Locale and Crypto answer, each line logged too. */
  protected async runModules(): Promise<void> {
    const { appInfo, crypto, locale } = this;
    const device = appInfo.device;
    const first = locale.locale();
    const calendar = locale.calendars()[0];
    const digest = crypto.available()
      ? await crypto.digestString(CryptoDigestAlgorithm.SHA256, 'abc')
      : 'absent';
    const rows = [
      `AppInfo ${appInfo.available()}: ${appInfo.id} ${appInfo.name} ${appInfo.version} (${appInfo.build})`,
      `Device: ${device.brand} ${device.model}, ${device.os} ${device.osVersion}, ${device.type}`,
      `Locales: ${locale
        .locales()
        .map((one) => one.languageTag)
        .join(', ')}`,
      `Formats: region ${first?.regionCode}, ${first?.measurementSystem}, ${(first as { currencyCode?: string } | null)?.currencyCode}`,
      `Calendar: ${calendar?.timeZone}, 24-hour ${calendar?.uses24hourClock}, first day ${calendar?.firstWeekday}`,
      `Crypto ${crypto.available()}: UUID ${crypto.available() ? crypto.randomUUID() : 'absent'}`,
      `SHA-256 of abc: ${digest.slice(0, 16)}...`,
    ];
    this.modules.set(rows);
    for (const row of rows) this.note(row);
  }

  /**
   * Fonts loading a monospaced font file the system has under the name CanaryMono, and ImageEditor
   * turning a 2 by 1 image (red, then blue) a quarter, flipping it and sizing it to 120 by 60.
   */
  protected async runMedia(): Promise<void> {
    try {
      await this.fonts.load({ CanaryMono: MONO_FONT });
      this.fontLoaded.set(this.fonts.has('CanaryMono'));
      this.note(`font CanaryMono loaded ${this.fonts.has('CanaryMono')}`);
    } catch (error) {
      this.note(`font failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const result = await this.editor.edit(
        RED_BLUE,
        [
          { rotate: 90 },
          { flip: FlipType.Vertical },
          { resize: { width: 60, height: 120 } },
          { rotate: -90 },
        ],
        { format: SaveFormat.PNG },
      );
      this.edited.set(result?.uri ?? null);
      this.note(`edited ${result ? `${result.width}x${result.height}` : 'absent'}`);
    } catch (error) {
      this.note(`edit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** A monospaced font file the Linux build image (AlmaLinux 9) has. */
const MONO_FONT = '/usr/share/fonts/adobe-source-code-pro/SourceCodePro-Regular.otf';

/** A 2 by 1 PNG: a red pixel, then a blue one. */
const RED_BLUE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==';

function tail(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}
