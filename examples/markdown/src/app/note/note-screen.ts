import { Component, computed, inject, input } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { followLink } from '../ui/follow-link.ts';
import { noteBySlug } from './notes.ts';

/** One note, drawn from the tokens Metro lexed as it bundled the app. */
@Component({
  imports: [Markdown, NativeHeader, ScrollView, Text, View],
  template: `
    <native-header [title]="title()" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        @if (note(); as note) {
          <view class="card document">
            <markdown [tokens]="note.file.tokens" (linkPress)="follow($event)" />
          </view>
        } @else {
          <text class="missing">There is no note called {{ slug() }}.</text>
        }
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export class NoteScreen {
  private readonly navigation = inject(NativeNavigation);

  readonly slug = input<string>();

  protected readonly note = computed(() => noteBySlug(this.slug()));
  protected readonly title = computed(() => this.note()?.file.attributes.title ?? 'Note');

  protected follow(link: MarkdownLinkPress): void {
    followLink(this.navigation, link);
  }
}
