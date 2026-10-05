import type { RouteMeta } from '@analogjs/router';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';
import { followMarkdownLink } from '../ui/markdown-link.ts';
import { MARKDOWN_THEMES, MarkdownThemes } from '../ui/markdown-themes.ts';

export const routeMeta: RouteMeta = { title: 'Styled Markdown' };

const DOCUMENT = `# Night of the long reads

## A story, styled three ways

One Markdown document, and three looks for it. Each look is a map of
**element to class** handed to \`<markdown [classes]>\`, and the classes are
plain CSS.

> The words stay the same. Only the classes change.

- Headings, paragraphs and quotes
- List items and their markers
- Links, like [the Markdown page](/markdown)

---

Tap a look above to switch it.
`;

/** One document drawn with the classes of the look that is chosen. */
@Component({
  imports: [FeatureNote, Markdown, MarkdownThemes, NativeHeader, Pressable, ScrollView, Text, View],
  template: `
    <native-header [title]="title" />
    <app-markdown-themes />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <view class="looks" accessibilityRole="tablist">
          @for (theme of themes; track theme.name) {
            <pressable
              class="look"
              [class.look-on]="theme === current()"
              accessibilityRole="tab"
              [accessibilityLabel]="theme.name"
              [accessibilityState]="{ selected: theme === current() }"
              (press)="current.set(theme)"
            >
              <text class="look-label" [class.look-label-on]="theme === current()">{{
                theme.name
              }}</text>
            </pressable>
          }
        </view>
        <view class="card" [class]="current().card">
          <markdown [source]="document" [classes]="classes()" (linkPress)="follow($event)" />
        </view>
        <app-feature-note
          file="src/app/pages/styled.page.ts"
          explanation="The same document with a different [classes] map: each Markdown element takes the app's class instead of the default one."
        />
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
  styles: `
    .looks {
      flex-direction: row;
      padding: 3px;
      border-radius: 10px;
      background-color: light-dark(#e3e3e8, #1c1c1e);
    }

    .look {
      flex: 1;
      height: 34px;
      border-radius: 8px;
      align-items: center;
      justify-content: center;
    }

    .look-on {
      background-color: light-dark(#ffffff, #3a3a3c);
    }

    .look-label {
      color: light-dark(#3a3a3c, #d1d1d6);
      font-size: 14px;
      font-weight: 500;
    }

    .look-label-on {
      color: #dd0330;
      font-weight: 700;
    }
  `,
})
export default class StyledPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly document = DOCUMENT;
  protected readonly themes = MARKDOWN_THEMES;
  protected readonly current = signal(MARKDOWN_THEMES[0]!);
  protected readonly classes = computed(() => this.current().classes);

  protected follow(link: MarkdownLinkPress): void {
    followMarkdownLink(this.navigation, link);
  }
}
