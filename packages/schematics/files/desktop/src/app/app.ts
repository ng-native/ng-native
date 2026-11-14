import { Component, computed, inject, signal } from '@angular/core';
import {
  MenuBar,
  MenuGroup,
  MenuItem,
  NativeButton,
  SafeAreaProvider,
  SafeAreaView,
  Sidebar,
  SidebarItem,
  SidebarSection,
  SplitView,
  Text,
} from '@ng-native/components';
// @ng-native/expo holds the services whose mobile source is Expo; on macOS the desktop host answers.
import { Clipboard } from '@ng-native/expo/clipboard';

interface Page {
  readonly id: string;
  readonly label: string;
  readonly sfSymbol: string;
  readonly hint: string;
}

const PAGES: readonly Page[] = [
  { id: 'home', label: 'Home', sfSymbol: 'house', hint: 'A native macOS app, written in Angular.' },
  { id: 'notes', label: 'Notes', sfSymbol: 'note.text', hint: 'Real AppKit views, no web view.' },
  { id: 'settings', label: 'Settings', sfSymbol: 'gearshape', hint: 'One runtime: no IPC.' },
];

/**
 * Element names are lowercase, and that is load-bearing rather than style: an uppercase name such
 * as <View> matches no component's selector, and the Metro transform fails the build on it.
 *
 * Sizes are a phone's by default and a Mac's under :host-context(.platform-macos), so the app is
 * Mac-sized now and still fits a phone if iOS or Android is added later.
 */
@Component({
  imports: [
    MenuBar,
    MenuGroup,
    MenuItem,
    NativeButton,
    SafeAreaProvider,
    SafeAreaView,
    Sidebar,
    SidebarItem,
    SidebarSection,
    SplitView,
    Text,
  ],
  selector: 'app-root',
  template: `
    <menu-bar>
      <menu-group label="Go" menuRole="view">
        @for (page of pages; track page.id; let i = $index) {
          <menu-item [label]="page.label" [shortcut]="'mod+' + (i + 1)" (select)="show(page.id)" />
        }
      </menu-group>
      <menu-group label="Edit" menuRole="edit">
        <menu-item label="Copy Page Title" shortcut="mod+shift+c" (select)="copyTitle()" />
      </menu-group>
    </menu-bar>

    <safe-area-provider>
      <split-view>
        <sidebar minWidth="180" autosave="main">
          <sidebar-section title="My App">
            @for (page of pages; track page.id) {
              <sidebar-item
                [label]="page.label"
                [sfSymbol]="page.sfSymbol"
                [selected]="page.id === current().id"
                (select)="show(page.id)"
              />
            }
          </sidebar-section>
        </sidebar>

        <safe-area-view class="content">
          <text class="title" accessibilityRole="header">{{ current().label }}</text>
          <text class="hint">{{ current().hint }}</text>
          <native-button (press)="copyTitle()">Copy Title</native-button>
          @if (copied()) {
            <text class="hint">Copied {{ copied() }}.</text>
          }
        </safe-area-view>
      </split-view>
    </safe-area-provider>
  `,
  styles: `
    :host {
      flex: 1;
    }
    .content {
      flex: 1;
      gap: 12px;
      padding: 24px;
      align-items: flex-start;
      background-color: #ffffff;
    }
    .title {
      color: #101014;
      font-size: 28px;
      font-weight: 700;
    }
    .hint {
      color: #5f5f6b;
      font-size: 15px;
    }
    :host-context(.platform-macos) .content {
      gap: 8px;
      padding: 20px;
    }
    :host-context(.platform-macos) .title {
      font-size: 22px;
    }
    :host-context(.platform-macos) .hint {
      font-size: 13px;
    }
    @media (prefers-color-scheme: dark) {
      .content {
        background-color: #1e1e20;
      }
      .title {
        color: #ffffff;
      }
      .hint {
        color: #8b8b96;
      }
    }
  `,
})
export class App {
  private readonly clipboard = inject(Clipboard);

  protected readonly pages = PAGES;
  private readonly selected = signal(PAGES[0]!.id);
  protected readonly current = computed(
    () => PAGES.find((page) => page.id === this.selected()) ?? PAGES[0]!,
  );
  protected readonly copied = signal('');

  protected show(id: string): void {
    this.selected.set(id);
  }

  protected async copyTitle(): Promise<void> {
    const title = this.current().label;
    await this.clipboard.write(title);
    this.copied.set(title);
  }
}
