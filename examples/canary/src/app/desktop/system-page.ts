import { Component, inject, input, signal } from '@angular/core';
import { NativeButton, ScrollView, Text, View } from '@ng-native/components';
import { Processes, Shell } from '@ng-native/device';
import { FileSystem, type FolderName } from '@ng-native/expo/file-system';
import { KeepAwake } from '@ng-native/expo/keep-awake';
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
 * and showing it in its folder. Each step logs on screen and to the console as `[system] ...`; a
 * launch link, `canary://desktop-system?run=watch` (or `shell`, `awake`), runs one.
 */
@Component({
  selector: 'x-system',
  imports: [NativeButton, NativeHeader, ScrollView, Text, View],
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
      </view>
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
  protected readonly folders = FOLDERS;
  protected readonly page = page;
  protected readonly log = signal<readonly string[]>([]);

  constructor() {
    queueMicrotask(() => {
      const run = this.run();
      if (run === 'watch') void this.runWatch();
      if (run === 'shell') void this.runShell();
      if (run === 'awake') void this.runAwake();
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
}

function tail(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}
