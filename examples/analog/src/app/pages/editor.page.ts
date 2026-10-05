import type { RouteMeta } from '@analogjs/router';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Pressable, ScrollView, Text, TextInput, View } from '@ng-native/components';
import { Markdown, type MarkdownLinkPress } from '@ng-native/components/markdown';
import { nativePlatform } from '@ng-native/fabric';
import { NativeHeader, NativeNavigation } from '@ng-native/router';
import { provideIcons } from '@ng-icons/core';
import { lucideClipboardPaste, lucideSparkles, lucideTrash2 } from '@ng-icons/lucide';
import { Clipboard } from '@ng-native/expo/clipboard';
import { NgIcon } from '@ng-native/icons';
import { FeatureNote } from '../ui/feature-note.ts';
import { followMarkdownLink } from '../ui/markdown-link.ts';

export const routeMeta: RouteMeta = { title: 'Markdown editor' };

const STARTER = `## Try it

Type **Markdown** here and the preview follows: _emphasis_, \`code\`, lists and
[a link to the blog](/blog).

- one
- two
`;

/** What Sample puts in the editor: one of everything `<markdown>` draws. */
const SAMPLE = `# Hello from Analog 👋

This is **real native text**, not a WebView.
Typed on the phone, drawn as *UIKit views*.

## Why it's cool

1. Pages are files in \`src/app/pages\`
2. Markdown renders **natively**
3. No HTML, no DOM, no ~~WebView~~

> Same Angular. Native everywhere.

\`\`\`ts
export default class HomePage {}
\`\`\`

[Open the blog](/blog)
`;

/** What each toolbar button adds to the end of the document. */
const SNIPPETS = [
  { label: 'H', name: 'Heading', text: '\n\n## Heading' },
  { label: 'B', name: 'Bold', text: ' **bold**' },
  { label: 'I', name: 'Italic', text: ' _italic_' },
  { label: '•', name: 'List item', text: '\n- item' },
  { label: '</>', name: 'Code', text: ' `code`' },
] as const;

/** A document typed on the device, parsed by marked as it changes, through `[source]`. */
@Component({
  imports: [
    FeatureNote,
    Markdown,
    NativeHeader,
    NgIcon,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
  ],
  template: `
    <native-header [title]="title" />
    <scroll-view
      class="scroll"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
    >
      <view class="content">
        <view class="card">
          <view class="toolbar">
            @for (snippet of snippets; track snippet.name) {
              <pressable
                class="tool"
                accessibilityRole="button"
                [accessibilityLabel]="snippet.name"
                (press)="insert(snippet.text)"
              >
                <text class="tool-label">{{ snippet.label }}</text>
              </pressable>
            }
            <view class="spacer"></view>
            <pressable
              class="action"
              accessibilityRole="button"
              accessibilityLabel="Sample"
              (press)="draft.set(sample)"
            >
              <ng-icon name="lucideSparkles" [size]="19" color="#dd0330" />
            </pressable>
            <pressable
              class="action"
              accessibilityRole="button"
              accessibilityLabel="Paste"
              (press)="paste()"
            >
              <ng-icon name="lucideClipboardPaste" [size]="19" color="#dd0330" />
            </pressable>
            <pressable
              class="action"
              accessibilityRole="button"
              accessibilityLabel="Clear"
              (press)="draft.set('')"
            >
              <ng-icon name="lucideTrash2" [size]="19" color="#dd0330" />
            </pressable>
          </view>
          <text-input
            class="source"
            [style.fontFamily]="monospace"
            multiline
            autoCapitalize="none"
            autoCorrect="false"
            placeholder="Write some Markdown"
            accessibilityLabel="Markdown source"
            [(value)]="draft"
          />
          <view class="preview">
            <text class="preview-label">Preview</text>
            <markdown [source]="draft()" (linkPress)="follow($event)" />
          </view>
        </view>
        <app-feature-note
          file="src/app/pages/editor.page.ts"
          explanation="What is typed is parsed on the device as it changes, and drawn by <markdown [source]> as native text and views."
        />
      </view>
    </scroll-view>
  `,
  providers: [provideIcons({ lucideClipboardPaste, lucideSparkles, lucideTrash2 })],
  styleUrl: '../ui/page.css',
  styles: `
    .toolbar {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      border-bottom-width: 1px;
      border-bottom-color: light-dark(#e5e5ea, #38383a);
    }

    .tool {
      min-width: 36px;
      height: 32px;
      padding: 0 8px;
      border-radius: 8px;
      align-items: center;
      justify-content: center;
      background-color: light-dark(#f2f2f7, #2c2c2e);
    }

    .tool-label {
      color: light-dark(#1c1c1e, #ffffff);
      font-size: 15px;
      font-weight: 700;
    }

    .spacer {
      flex: 1;
    }

    .action {
      width: 34px;
      height: 32px;
      align-items: center;
      justify-content: center;
    }

    .source {
      min-height: 150px;
      padding: 14px 16px;
      color: light-dark(#1c1c1e, #ffffff);
      font-size: 14px;
      line-height: 21px;
    }

    .preview {
      gap: 8px;
      padding: 14px 16px 18px;
      border-top-width: 1px;
      border-top-color: light-dark(#e5e5ea, #38383a);
      background-color: light-dark(#fafafc, #161618);
    }

    .preview-label {
      color: #8e8e93;
      font-size: 12px;
      font-weight: 600;
    }
  `,
})
export default class EditorPage {
  private readonly navigation = inject(NativeNavigation);
  private readonly clipboard = inject(Clipboard);

  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
  protected readonly snippets = SNIPPETS;
  protected readonly sample = SAMPLE;
  protected readonly draft = signal(STARTER);
  protected readonly monospace = nativePlatform() === 'ios' ? 'Menlo' : 'monospace';

  protected insert(text: string): void {
    this.draft.update((draft) => draft.trimEnd() + text);
  }

  protected async paste(): Promise<void> {
    const text = await this.clipboard.read();
    if (text) this.insert(`\n\n${text}`);
  }

  protected follow(link: MarkdownLinkPress): void {
    followMarkdownLink(this.navigation, link);
  }
}
