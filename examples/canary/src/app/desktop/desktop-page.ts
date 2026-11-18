import { Component, computed, inject, signal } from '@angular/core';
import {
  ContextMenu,
  DragItem,
  FileDrop,
  MenuBar,
  MenuGroup,
  MenuItem,
  NativeButton,
  Pressable,
  ScrollView,
  Shortcut,
  Text,
  TrayIcon,
  View,
  type FileDropEvent,
} from '@ng-native/components';
import { AppWindows, OS, Tray, UndoStack, type OsName } from '@ng-native/device';
import { Notifications } from '@ng-native/expo/notifications';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';
import { LibraryWindow } from './library-window.ts';
import { TitleBarWindow } from './title-bar-window.ts';

/** What each OS is called in the screen's text: `OS` answers `'macos'` and `'linux'`. */
const OS_LABELS: Record<OsName, string> = {
  ios: 'iOS',
  android: 'Android',
  macos: 'macOS',
  linux: 'Linux',
  web: 'the web host',
};

/**
 * Where the Canary menu is on each OS and where its shortcuts work, from the support matrix
 * (`OS_SUPPORT`): a menu bar on macOS and iPadOS, GTK's on Linux, nothing drawn on iPhone and
 * Android, and `mod` is Ctrl on Linux and Android.
 */
const MENU_NOTES: Record<OsName, string> = {
  macos:
    'The menu bar has a Canary menu while this screen is open, and its shortcuts work from the keyboard.',
  linux:
    "The Canary menu is a menu bar under the header bar on KDE Plasma and in the header bar's main menu elsewhere while this screen is open, and its shortcuts work with Ctrl.",
  ios: 'On an iPad the menu bar has a Canary menu while this screen is open, and its shortcuts work from a hardware keyboard on an iPad or an iPhone.',
  android:
    "No menu bar is drawn, and the Canary menu's shortcuts work from a hardware keyboard with Ctrl, Alt, Shift or Meta held.",
  web: "The web host draws no menu bar, and the Canary menu's shortcuts work from the keyboard.",
};

/**
 * What a desktop app has that a phone app does not: a menu bar of the app's own, keyboard shortcuts,
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
    Pressable,
    ScrollView,
    Shortcut,
    Text,
    TrayIcon,
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
      <text class="hint"> On {{ osLabel }}. {{ menuNote }} </text>

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

      <text class="heading">Tray and badge</text>
      <view class="desktop-row">
        <native-button testID="tray" [disabled]="!tray.available()" (press)="toggleTray()">
          {{ trayShown() ? 'Hide the Tray Icon' : 'Show a Tray Icon' }}
        </native-button>
        <native-button testID="badge" (press)="badgeStars()">Badge the Stars</native-button>
      </view>
      @if (trayShown()) {
        <tray-icon sfSymbol="star" [title]="stars() + ' stars'" tooltip="Canary stars">
          <menu-item label="Add a Star" (select)="addStar()" />
          <menu-item label="Clear Stars" (select)="clearStars()" />
        </tray-icon>
      }
      <text class="hint">{{ trayNote() }}</text>

      <text class="heading">Context menu</text>
      <view class="card" testID="menu-card" [nativeID]="cardName()" [contextMenu]="cardMenu">
        <text class="body">Right-click, or long press, for a menu.</text>
        <text class="hint">{{ chosen() }}</text>
        <pressable
          class="card"
          testID="menu-handle"
          (press)="chosen.set('The handle was pressed.')"
          (longPress)="chosen.set('The handle was long pressed.')"
        >
          <text class="body">A long press here is the handle's own, not the menu's.</text>
        </pressable>
      </view>
      <native-button testID="rename-card" (press)="renameCard()">
        Rename the card's nativeID
      </native-button>
      <text class="hint">The card is named {{ cardName() ?? 'by the menu' }}.</text>
      <ng-template #cardMenu>
        <menu-item label="Add a Star" (select)="addStar()" />
        <menu-item label="Clear Stars" destructive (select)="clearStars()" />
      </ng-template>
      <view
        shortcut="mod+k"
        shortcutLabel="Say mod+k"
        (shortcutPress)="chosen.set('mod+k pressed')"
      ></view>

      <text class="heading">Windows</text>
      <native-button testID="library" (press)="openLibrary()">Open Library</native-button>
      <native-button testID="title-bar" (press)="openTitleBar()">
        Open a Window with a Transparent Title Bar
      </native-button>
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
        >On macOS, Linux and iPadOS. Nothing fires on iPhone, Android or the web host.</text
      >
    </scroll-view>
  `,
})
export class DesktopPage {
  protected readonly undo = inject(UndoStack);
  protected readonly tray = inject(Tray);
  private readonly notifications = inject(Notifications);
  private readonly windows = inject(AppWindows);
  private readonly os = inject(OS);
  protected readonly osLabel = OS_LABELS[this.os];
  protected readonly menuNote = MENU_NOTES[this.os];
  protected readonly page = page;

  protected readonly stars = signal(0);
  protected readonly chosen = signal('Nothing chosen yet.');
  /** The card's own nativeID, renamed and taken away in turn: its menu follows each. */
  protected readonly cardName = signal<string | undefined>(undefined);
  protected readonly over = signal(false);
  protected readonly drops = signal<readonly string[]>([]);
  protected readonly windowNote = signal('');
  protected readonly trayShown = signal(false);
  protected readonly trayNote = computed(() =>
    this.tray.available()
      ? 'The tray icon menu adds and clears stars. The badge is the star count on the app icon, where the OS draws one.'
      : 'This OS has no tray here. The badge is the star count on the app icon, where the OS draws one.',
  );
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

  protected toggleTray(): void {
    this.trayShown.update((shown) => !shown);
  }

  protected badgeStars(): void {
    this.notifications.setBadge(this.stars());
  }

  protected renameCard(): void {
    const names = [undefined, 'menu-card-1', 'menu-card-2'];
    this.cardName.update((name) => names[(names.indexOf(name) + 1) % names.length]);
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

  protected async openTitleBar(): Promise<void> {
    const window = await this.windows.open(TitleBarWindow, {
      title: 'Title Bar',
      width: 520,
      height: 240,
      titleBar: 'transparent',
      autosave: false,
    });
    if (!window) this.windowNote.set('This OS has one window.');
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
