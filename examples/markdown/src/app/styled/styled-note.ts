import { Component, inject } from '@angular/core';
import { ScrollView, View } from '@ng-native/components';
import {
  Markdown,
  type MarkdownClasses,
  type MarkdownLinkPress,
} from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { STYLED_NOTE } from '../note/notes.ts';
import { followLink } from '../ui/follow-link.ts';
import { SerifTheme } from './serif-theme.ts';

/**
 * Headings, paragraphs and quotes take the app's classes in place of the defaults; a link keeps
 * `md-a` beside its own, so it is still underlined and colored.
 */
const CLASSES: MarkdownClasses = {
  h1: 'serif-h1',
  h2: 'serif-h2',
  p: 'serif-p',
  a: 'md-a serif-a',
  blockquote: 'serif-quote',
};

/** A note drawn with `classes`, from a global stylesheet. */
@Component({
  imports: [Markdown, NativeHeader, ScrollView, SerifTheme, View],
  template: `
    <native-header [title]="note.file.attributes.title" />
    <app-serif-theme />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <view class="card document">
          <markdown [tokens]="note.file.tokens" [classes]="classes" (linkPress)="follow($event)" />
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
})
export class StyledNote {
  private readonly navigation = inject(NativeNavigation);

  protected readonly note = STYLED_NOTE;
  protected readonly classes = CLASSES;

  protected follow(link: MarkdownLinkPress): void {
    followLink(this.navigation, link);
  }
}
