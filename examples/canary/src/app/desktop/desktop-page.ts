import { Component, computed, inject, signal } from '@angular/core';
import {
  ContextMenu,
  DragItem,
  FileDrop,
  MenuBar,
  MenuGroup,
  MenuItem,
  NativeButton,
  ScrollView,
  Shortcut,
  Text,
  View,
  type FileDropEvent,
} from '@ng-native/components';
import { AppWindows, OS, UndoStack } from '@ng-native/device';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';
import { LibraryWindow } from './library-window.ts';

/**
 * What a Mac app has that a phone app does not: a menu bar of the app's own, keyboard shortcuts,
 * context menus, windows, drag and drop, and undo. Each section says what it does on the OS the
 * app is on, so the screen is worth opening on iOS and Android too.
 */
@Component({
  selector: 'x-desktop',
  imports: [
    ContextMenu,
    DragItem,
    FileDrop,
    MenuBar,
    MenuGroup,
    MenuItem,
    NativeButton,
    NativeHeader,
    ScrollView,
    Shortcut,
    Text,
    View,
  ],
  template: `
    <native-header title="Desktop" />
    <menu-bar>
      <menu-group label="Canary">
        <menu-item label="Add a Star" shortcut="mod+shift+s" (select)="addStar()" />
        <menu-item label="Open Library" shortcut="mod+shift+l" (select)="openLibrary()" />
      </menu-group>
    </menu-bar>
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        On {{ os }}. The menu bar has a Canary menu while this screen is open, and its shortcuts
        work from a hardware keyboard on iPad, iPhone and Android.
      </text>

      <text class="heading">Stars and undo</text>
      <text class="body">{{ stars() }} stars</text>
      <view class="desktop-row">
        <native-button testID="star" (press)="addStar()">Add a Star</native-button>
        <native-button [disabled]="!undo.canUndo()" (press)="undo.undo()">
          {{ undoTitle() }}
        </native-button>
      </view>
      <text class="hint">
        Edit > Undo takes a star back while no text field has focus.
        {{ undo.available() ? '' : 'This OS has no undo manager, so undo does nothing here.' }}
      </text>

      <text class="heading">Context menu</text>
      <view class="card" testID="menu-card" [contextMenu]="cardMenu">
        <text class="body">Right-click, or long press, for a menu.</text>
        <text class="hint">{{ chosen() }}</text>
      </view>
      <ng-template #cardMenu>
        <menu-item label="Add a Star" (select)="addStar()" />
        <menu-item label="Clear Stars" destructive (select)="clearStars()" />
      </ng-template>
      <view shortcut="mod+k" (shortcutPress)="chosen.set('mod+k pressed')"></view>

      <text class="heading">Windows</text>
      <native-button testID="library" (press)="openLibrary()">Open Library</native-button>
      <text class="hint">{{ windowNote() }}</text>

      <text class="heading">Drag and drop</text>
      <view
        class="card desktop-drop"
        testID="drop"
        [class.desktop-drop-over]="over()"
        (fileDragEnter)="over.set(true)"
        (fileDragLeave)="over.set(false)"
        (fileDrop)="dropped($event)"
      >
        <text class="body">Drop files, text or a link here.</text>
        @for (line of drops(); track $index) {
          <text class="hint">{{ line }}</text>
        }
      </view>
      <view
        class="card"
        [dragItem]="{ text: 'A star from the canary', url: 'https://ng-native.dev' }"
      >
        <text class="body">Drag this card into another app.</text>
      </view>
      <text class="hint"
        >On macOS and iPadOS. Nothing fires on iPhone, Android or the web host.</text
      >
    </scroll-view>
  `,
})
export class DesktopPage {
  protected readonly undo = inject(UndoStack);
  private readonly windows = inject(AppWindows);
  protected readonly os = inject(OS);
  protected readonly page = page;

  protected readonly stars = signal(0);
  protected readonly chosen = signal('Nothing chosen yet.');
  protected readonly over = signal(false);
  protected readonly drops = signal<readonly string[]>([]);
  protected readonly windowNote = signal('');
  protected readonly undoTitle = computed(() =>
    this.undo.undoLabel() ? 'Undo ' + this.undo.undoLabel() : 'Undo',
  );

  protected addStar(): void {
    this.stars.update((count) => count + 1);
    this.chosen.set('Added a star.');
    this.undo.push({
      label: 'Add a Star',
      undo: () => this.stars.update((count) => count - 1),
      redo: () => this.stars.update((count) => count + 1),
    });
  }

  protected clearStars(): void {
    const before = this.stars();
    this.stars.set(0);
    this.chosen.set('Cleared the stars.');
    this.undo.push({
      label: 'Clear Stars',
      undo: () => this.stars.set(before),
      redo: () => this.stars.set(0),
    });
  }

  protected async openLibrary(): Promise<void> {
    const window = await this.windows.open(LibraryWindow, {
      title: 'Library',
      width: 640,
      height: 420,
      restoreKey: 'library',
    });
    this.windowNote.set(
      window ? 'The library is open in its own window.' : 'This OS has one window.',
    );
  }

  protected dropped(drop: FileDropEvent): void {
    this.over.set(false);
    const lines = [
      ...drop.files.map((file) => 'File ' + file.name),
      ...(drop.text ? ['Text ' + drop.text] : []),
      ...drop.urls.map((url) => 'Link ' + url),
    ];
    this.drops.update((all) => [...lines, ...all].slice(0, 5));
  }
}
