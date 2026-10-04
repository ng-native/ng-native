import { Component } from '@angular/core';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader, NativeRouterLink } from '@ng-native/router';
import { NOTES } from '../note/notes.ts';

/** The notes, by their front matter, and the two screens that are not notes. */
@Component({
  imports: [NativeHeader, NativeRouterLink, Pressable, ScrollView, Text, View],
  template: `
    <native-header title="Markdown Reader" largeTitle />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
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
            </view>
            <text class="chevron">›</text>
          </pressable>
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export class Library {
  protected readonly notes = NOTES;
}
