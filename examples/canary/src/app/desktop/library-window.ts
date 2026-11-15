import { Component, computed, signal } from '@angular/core';
import {
  SafeAreaView,
  Sidebar,
  SidebarItem,
  SidebarSection,
  SplitView,
  Text,
} from '@ng-native/components';

interface Shelf {
  readonly id: string;
  readonly label: string;
  readonly sfSymbol: string;
  readonly books: readonly string[];
}

const SHELVES: readonly Shelf[] = [
  { id: 'reading', label: 'Reading', sfSymbol: 'book', books: ['Middlemarch', 'Dune'] },
  { id: 'later', label: 'Later', sfSymbol: 'clock', books: ['The Waves'] },
  { id: 'done', label: 'Finished', sfSymbol: 'checkmark.circle', books: [] },
];

/**
 * A window of its own with a sidebar: the source list on macOS and iPadOS, a stack root on
 * iPhone, a list pane on a wide Android screen and two columns in the web host.
 */
@Component({
  selector: 'x-library-window',
  imports: [SafeAreaView, Sidebar, SidebarItem, SidebarSection, SplitView, Text],
  template: `
    <split-view>
      <sidebar minWidth="160" autosave="library">
        <sidebar-section title="Shelves">
          @for (shelf of shelves; track shelf.id) {
            <sidebar-item
              [label]="shelf.label"
              [sfSymbol]="shelf.sfSymbol"
              [badge]="shelf.books.length || null"
              [selected]="shelf.id === current().id"
              (select)="selected.set(shelf.id)"
            />
          }
        </sidebar-section>
      </sidebar>
      <safe-area-view class="screen desktop-pane">
        <text class="heading">{{ current().label }}</text>
        @for (book of current().books; track book) {
          <text class="body">{{ book }}</text>
        } @empty {
          <text class="hint">Nothing on this shelf.</text>
        }
      </safe-area-view>
    </split-view>
  `,
})
export class LibraryWindow {
  protected readonly shelves = SHELVES;
  protected readonly selected = signal(SHELVES[0]!.id);
  protected readonly current = computed(
    () => SHELVES.find((shelf) => shelf.id === this.selected()) ?? SHELVES[0]!,
  );
}
