import { Component } from '@angular/core';
import { Image, Pressable, ScrollView, Text, View } from '@ng-native/components';
import { nativePlatform } from '@ng-native/fabric';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { NOTES } from '../note/notes.ts';

/** The files in `pages/`, and the URL `fileRoutes` gives each one. */
export const ROUTES: readonly { readonly file: string; readonly url: string }[] = [
  { file: 'index.page.ts', url: '/' },
  { file: 'notes/[slug].page.ts', url: '/notes/:slug' },
  { file: 'editor.page.ts', url: '/editor' },
  { file: 'styled.page.ts', url: '/styled' },
  { file: 'about.md', url: '/about' },
];

/** `/`: the notes, by their front matter, and the screens that are not notes. */
@Component({
  imports: [Image, NativeHeader, NativeRouterLink, Pressable, ScrollView, Text, View],
  template: `
    <native-header title="Native Pages" largeTitle />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <view class="card hero">
          <image class="hero-logo" [source]="logo" alt="Angular Native" />
          <text class="hero-title">Angular Native</text>
          <text class="hero-sub"
            >File routes and Markdown, drawn as native iOS and Android views</text
          >
        </view>
        <text class="section">FILE ROUTES</text>
        <view class="card routes" accessibilityLabel="File routes">
          <text class="row-sub">Every file in src/app/pages is a route, through fileRoutes().</text>
          @for (route of routes; track route.file) {
            <view class="route">
              <text class="route-file" [style.fontFamily]="monospace">{{ route.file }}</text>
              <text class="route-url" [style.fontFamily]="monospace">{{ route.url }}</text>
            </view>
          }
        </view>
        <text class="section">NOTES</text>
        <view class="card">
          @for (note of notes; track note.slug; let first = $first) {
            <pressable
              accessibilityRole="button"
              [accessibilityLabel]="note.file.attributes.title"
              class="row"
              [class.row-divider]="!first"
              [nativeRouterLink]="['/notes', note.slug]"
            >
              <view class="row-body">
                <text class="row-title">{{ note.file.attributes.title }}</text>
                <text class="row-sub">{{ note.file.attributes.summary }}</text>
                <text class="row-file" [style.fontFamily]="monospace"
                  >notes/[slug].page.ts → /notes/{{ note.slug }}</text
                >
              </view>
              <text class="chevron">›</text>
            </pressable>
          }
        </view>
        <text class="section">TRY IT</text>
        <view class="card">
          <pressable
            accessibilityRole="button"
            accessibilityLabel="Live editor"
            class="row"
            nativeRouterLink="/editor"
          >
            <view class="row-body">
              <text class="row-title">Live editor</text>
              <text class="row-sub">Markdown typed on the device, parsed as you type.</text>
              <text class="row-file" [style.fontFamily]="monospace">editor.page.ts → /editor</text>
            </view>
            <text class="chevron">›</text>
          </pressable>
          <pressable
            accessibilityRole="button"
            accessibilityLabel="Styled with classes"
            class="row row-divider"
            nativeRouterLink="/styled"
          >
            <view class="row-body">
              <text class="row-title">Styled with classes</text>
              <text class="row-sub">A note whose elements take the app's own classes.</text>
              <text class="row-file" [style.fontFamily]="monospace">styled.page.ts → /styled</text>
            </view>
            <text class="chevron">›</text>
          </pressable>
          <pressable
            accessibilityRole="button"
            accessibilityLabel="A Markdown page"
            class="row row-divider"
            nativeRouterLink="/about"
          >
            <view class="row-body">
              <text class="row-title">A Markdown page</text>
              <text class="row-sub">A .md file in pages/ is a screen of its own.</text>
              <text class="row-file" [style.fontFamily]="monospace">about.md → /about</text>
            </view>
            <text class="chevron">›</text>
          </pressable>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
  styles: `
    .row-file {
      margin-top: 2px;
      color: #dd0031;
      font-size: 12px;
    }

    .routes {
      padding: 14px 16px;
      gap: 8px;
    }

    .route {
      flex-direction: row;
      justify-content: space-between;
      gap: 12px;
    }

    .route-file {
      flex: 1;
      color: light-dark(#1c1c1e, #ffffff);
      font-size: 13px;
    }

    .route-url {
      color: #dd0031;
      font-size: 13px;
    }
  `,
})
export default class Library {
  protected readonly logo = require('../../../assets/angular-native.png');
  protected readonly notes = NOTES;
  protected readonly routes = ROUTES;
  protected readonly monospace = nativePlatform() === 'android' ? 'monospace' : 'Menlo';
}
