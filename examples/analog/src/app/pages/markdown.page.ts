import type { RouteMeta } from '@analogjs/router';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { FeatureNote } from '../ui/feature-note.ts';
import { followMarkdownLink } from '../ui/markdown-link.ts';

export const routeMeta: RouteMeta = { title: 'Markdown' };

const DOCUMENT = `# Release notes

Angular Native draws **Markdown** as *native* views: no web view, and ~~no HTML~~ nothing
interpreted. Inline \`code\`, [a link to the About page](/about) and
[Analog's site](https://analogjs.org "analogjs.org") all sit in one paragraph.

## What changed

1. Pages are files
2. Their paths are their URLs
   - nested lists indent
   - [x] task lists check off
   - [ ] and leave the rest open

> A quote, set off by a rule down its side.

\`\`\`ts
export const routeMeta: RouteMeta = { title: 'Markdown' };
\`\`\`

| Feature | File |
| ------- | ---- |
| Static page | about.page.ts |
| Catch-all | docs/[...slug].page.ts |

---

<b>Raw HTML</b> is shown as the text it is &amp; entities are decoded.

![The Analog logo](https://analogjs.org/img/logos/analog-logo.png)
`;

/** A Markdown document, drawn natively, with its relative links routed in the app. */
@Component({
  imports: [FeatureNote, Markdown, NativeHeader, ScrollView, View],
  template: `
    <native-header [title]="title" />
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note
          file="src/app/pages/markdown.page.ts"
          explanation="<markdown> from @ng-native/components/markdown draws a document as native text and views. A relative link is routed here; an absolute one opens outside the app."
        />
        <view class="card document">
          <markdown [source]="document" (linkPress)="follow($event)" />
        </view>
      </view>
    </scroll-view>
  `,
  styleUrl: '../ui/page.css',
  styles: `
    .document {
      padding: 16px;
    }
  `,
})
export default class MarkdownPage {
  private readonly navigation = inject(NativeNavigation);

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly document = DOCUMENT;

  protected follow(link: MarkdownLinkPress): void {
    followMarkdownLink(this.navigation, link);
  }
}
