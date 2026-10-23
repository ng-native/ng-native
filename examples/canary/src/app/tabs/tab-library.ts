import { Component, inject, input } from '@angular/core';
import { Pressable, ScrollView, Text } from '@ng-native/components';
import { NativeHeader, NativeNavigation, NativeStackOutlet } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * A tab that is itself a stack, which is the composition a real tab bar is built on: pushing
 * inside a tab leaves the bar in place, and each tab remembers its own depth.
 */
@Component({
  selector: 'x-tab-library',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class TabLibrary {}

@Component({
  selector: 'x-library-list',
  imports: [NativeHeader, Pressable, ScrollView, Text],
  template: `
    <native-header title="Library" [largeTitle]="true" />
    <scroll-view
      class="screen"
      contentInsetAdjustmentBehavior="automatic"
      [contentContainerStyle]="page.content"
    >
      <text class="hint">
        Pushing from here keeps the tab bar. Switch tabs and come back: the pushed screen is still
        there, because the whole tab was detached rather than destroyed.
      </text>
      @for (album of albums; track album) {
        <pressable class="card" (press)="open(album)">
          <text class="button-label">{{ album }}</text>
        </pressable>
      }
    </scroll-view>
  `,
})
export class LibraryList {
  private readonly navigation = inject(NativeNavigation);

  protected readonly page = page;
  protected readonly albums = ['Kind of Blue', 'Blue Train', 'Giant Steps'];

  protected open(album: string): void {
    void this.navigation.push(['/tabs/library', album]);
  }
}

@Component({
  selector: 'x-library-album',
  imports: [NativeHeader, Pressable, ScrollView, Text],
  template: `
    <native-header [title]="album()" backTitle="Library" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="heading">{{ album() }}</text>
      <text class="body">
        Still inside the library tab. The bar is native chrome around this stack, not part of it.
      </text>
      <pressable class="card" (press)="openNotes()">
        <text class="button-label">Read the liner notes</text>
      </pressable>
    </scroll-view>
  `,
})
export class LibraryAlbum {
  private readonly navigation = inject(NativeNavigation);

  /** Bound from the route param by the outlet's input binding. */
  readonly album = input('');

  protected readonly page = page;

  protected openNotes(): void {
    void this.navigation.push(['/tabs/library', this.album(), 'notes']);
  }
}

/**
 * A page that hides the tab bar while it is in front, as a reader or a checkout does: the bar
 * comes back when it is popped.
 */
@Component({
  selector: 'x-library-notes',
  imports: [NativeHeader, ScrollView, Text],
  template: `
    <native-header title="Liner notes" [tabBarHidden]="true" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="heading">{{ album() }}</text>
      <text class="body">
        The tab bar is hidden while this page is in front, and comes back when it is popped.
      </text>
    </scroll-view>
  `,
})
export class LibraryNotes {
  /** Bound from the route param by the outlet's input binding. */
  readonly album = input('');

  protected readonly page = page;
}
