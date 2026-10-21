/**
 * Markdown, drawn as native views and text.
 *
 * Its own entry point because it parses with `marked`, an optional peer dependency an app installs
 * only when it renders Markdown: the barrel never imports it, so an app that does not is not asked
 * for it.
 *
 * ```ts
 * import { Markdown } from '@ng-native/components/markdown';
 * ```
 */
import {
  Component,
  Injector,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { DeepLinks } from '@ng-native/device';
import { nativePlatform } from '@ng-native/fabric';
import { lexer, type Token } from 'marked';
import type { ImageLoadEvent, LayoutEvent } from './events.ts';
import { Image } from './image.ts';
import {
  blockKey,
  markdownBlocks,
  opensOnPress,
  shareBlocks,
  type MarkdownBlock,
  type MarkdownElement,
  type MarkdownInline,
} from './markdown-blocks.ts';
import { MarkdownColumns } from './markdown-columns.ts';
import { MarkdownStream } from './markdown-stream.ts';
import { ScrollView } from './scroll-view.ts';
import { TemplateSlot } from './template-slot.ts';
import { Text } from './text.ts';
import { View } from './view.ts';

export type { MarkdownElement } from './markdown-blocks.ts';

/** Classes for the elements a document is drawn with, each one in place of the default. */
export type MarkdownClasses = Partial<Readonly<Record<MarkdownElement, string>>>;

/** `(linkPress)`: a link was pressed. */
export interface MarkdownLinkPress {
  /** The target as written, after its entities are decoded and its scheme was allowed. */
  readonly href: string;
  readonly title: string | null;
  /** Keep the link from being opened, to handle it in the app instead. */
  preventDefault(): void;
}

const ELEMENTS: readonly MarkdownElement[] = [
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li', 'marker'],
  ...['pre', 'code', 'strong', 'em', 'del', 'a', 'hr', 'img', 'table', 'tr', 'th', 'td'],
] as MarkdownElement[];

const DEFAULT_CLASSES = Object.fromEntries(
  ELEMENTS.map((element) => [element, `md-${element}`]),
) as Readonly<Record<MarkdownElement, string>>;

type MarkdownLink = Extract<MarkdownInline, { kind: 'link' }>;

/** A loaded image's own width in points, and its width over its height. */
interface ImageSize {
  readonly width: number;
  readonly ratio: number;
}

type ImageBlock = Extract<MarkdownBlock, { kind: 'image' }>;

/** Every image in `blocks`, however deep in quotes and lists. */
function imageBlocks(
  blocks: readonly MarkdownBlock[],
  into = new Set<ImageBlock>(),
): Set<ImageBlock> {
  for (const block of blocks) {
    if (block.kind === 'image') into.add(block);
    else if (block.kind === 'blockquote') imageBlocks(block.children, into);
    else if (block.kind === 'list') {
      for (const item of block.items) imageBlocks(item.children, into);
    }
  }
  return into;
}

/**
 * A Markdown document as `<text>`, `<view>`, `<image>` and `<scroll-view>`: headings, paragraphs,
 * emphasis, inline code, links, quotes, ordered, unordered and task lists, code blocks, rules,
 * tables and images.
 *
 * `source` is parsed with `marked.lexer`; `tokens` takes tokens lexed already, and wins when both
 * are set. A paragraph is one `<text>` with a nested `<text>` for each emphasis, code span and
 * link, so it wraps as one run; an image is lifted out to a block of its own.
 *
 * Nothing in the document is interpreted. Raw HTML is drawn as the text it is written as, a link
 * is followed only to `http`, `https`, `mailto`, `tel` or a relative target, and an image is
 * loaded only over `http` or `https`; anything else is drawn as its text.
 *
 * Each element carries a default class, `md-h1`, `md-p`, `md-a` and so on, styled in light and
 * dark. `classes` replaces one by its element's name, so a global stylesheet or Tailwind styles it
 * instead: `{ h1: 'text-3xl font-bold' }`. Put the default back beside your own to keep both.
 *
 * For a source that grows as it streams in, an answer arriving a few words at a time, set
 * `streaming` until it is complete. The blocks before the last one are then kept as they are and
 * only the last is lexed and converted again, unless a chunk defines or changes a link reference,
 * which can change a block already kept, and the whole source is lexed again. Syntax still open at its end, a code span, an emphasis, a link,
 * an image or a table row, is held back until it closes. Of a code fence only an unfinished
 * opening line is held back, and its code then streams as it arrives. Clearing `streaming` draws
 * the whole source as written, and `tokens` are always drawn as given. A block that did not
 * change keeps its views, streaming or not.
 *
 * A pressed link is `(linkPress)`. An absolute target is then opened with `DeepLinks.open` unless
 * a handler calls `preventDefault()`; a relative one is only reported, for the app to route.
 */
@Component({
  selector: 'markdown',
  imports: [Image, MarkdownColumns, ScrollView, TemplateSlot, Text, View],
  template: `
    <ng-template #blockTemplate let-list>
      @for (block of list; track blockKey(block)) {
        @switch (block.kind) {
          @case ('heading') {
            <text [class]="classFor(block.element)" accessibilityRole="header"
              ><ng-container *templateSlot="inlineTemplate; context: { $implicit: block.children }"
            /></text>
          }
          @case ('paragraph') {
            <text [class]="classFor('p')"
              ><ng-container *templateSlot="inlineTemplate; context: { $implicit: block.children }"
            /></text>
          }
          @case ('image') {
            <image
              [src]="block.src"
              [alt]="block.alt || undefined"
              resizeMode="contain"
              [class]="classFor('img')"
              [style.--md-img-width]="imageWidth(block.src)"
              [style.aspectRatio]="sizes().get(block.src)?.ratio ?? null"
              [style.height]="imageHeight(block)"
              (load)="sizeImage(block.src, $any($event))"
              (layout)="layOutImage(block, $any($event))"
            />
          }
          @case ('blockquote') {
            <view [class]="classFor('blockquote')">
              <ng-container *templateSlot="blockTemplate; context: { $implicit: block.children }" />
            </view>
          }
          @case ('list') {
            <view [class]="classFor(block.element)">
              @for (item of block.items; track $index) {
                <view [class]="classFor('li')">
                  <text [class]="classFor('marker')">{{ item.marker }}</text>
                  <view class="md-li-body">
                    <ng-container
                      *templateSlot="blockTemplate; context: { $implicit: item.children }"
                    />
                  </view>
                </view>
              }
            </view>
          }
          @case ('code') {
            <scroll-view horizontal [class]="classFor('pre')">
              <text selectable class="md-pre-text">{{ block.text }}</text>
            </scroll-view>
          }
          @case ('hr') {
            <view [class]="classFor('hr')"></view>
          }
          @case ('table') {
            <scroll-view horizontal>
              <view
                [class]="classFor('table')"
                [markdownColumns]="block"
                #columns="markdownColumns"
              >
                <view [class]="classFor('tr')">
                  @for (cell of block.header; track $index; let column = $index) {
                    <view class="md-cell" [style.minWidth]="columns.width(column)">
                      <text
                        [class]="classFor('th')"
                        (layout)="columns.measure(0, column, $any($event))"
                        ><ng-container *templateSlot="inlineTemplate; context: { $implicit: cell }"
                      /></text>
                    </view>
                  }
                </view>
                @for (row of block.rows; track $index; let r = $index) {
                  <view [class]="classFor('tr')">
                    @for (cell of row; track $index; let column = $index) {
                      <view class="md-cell md-cell-body" [style.minWidth]="columns.width(column)">
                        <text
                          [class]="classFor('td')"
                          (layout)="columns.measure(r + 1, column, $any($event))"
                          ><ng-container
                            *templateSlot="inlineTemplate; context: { $implicit: cell }"
                        /></text>
                      </view>
                    }
                  </view>
                }
              </view>
            </scroll-view>
          }
        }
      }
    </ng-template>

    <ng-template #inlineTemplate let-runs>
      @for (run of runs; track $index) {
        @switch (run.kind) {
          @case ('text') {
            <ng-container>{{ run.text }}</ng-container>
          }
          @case ('code') {
            <text [class]="classFor('code')">{{ run.text }}</text>
          }
          @case ('link') {
            <text
              [class]="classFor('a')"
              pressable
              [accessibilityHint]="run.title ?? undefined"
              (press)="followLink(run)"
              ><ng-container *templateSlot="inlineTemplate; context: { $implicit: run.children }"
            /></text>
          }
          @default {
            <text [class]="classFor(run.kind)"
              ><ng-container *templateSlot="inlineTemplate; context: { $implicit: run.children }"
            /></text>
          }
        }
      }
    </ng-template>

    <ng-container *templateSlot="blockTemplate; context: { $implicit: blocks() }" />
  `,
  styleUrl: './markdown.css',
  host: {
    '[class.md-ios]': "platform === 'ios'",
    '[class.md-android]': "platform === 'android'",
  },
})
export class Markdown {
  private readonly injector = inject(Injector);
  /** Which monospace font code is drawn in, as the platform names it. */
  protected readonly platform = nativePlatform();

  /** The Markdown to draw. */
  readonly source = input<string>();
  /** Tokens `marked.lexer` made already, drawn in place of `source`. */
  readonly tokens = input<readonly Token[]>();
  /**
   * Whether `source` is still arriving, a chunk at a time. While it is, only its last block is
   * lexed again, unless a link reference changes, and syntax still open at its end is held back.
   * See the class note.
   */
  readonly streaming = input(false, { transform: booleanAttribute });
  /** A class for an element, in place of its default. See the class note. */
  readonly classes = input<MarkdownClasses>({});
  /** A link was pressed. See the class note. */
  readonly linkPress = output<MarkdownLinkPress>();

  private readonly stream = new MarkdownStream();
  protected readonly blockKey = blockKey;

  /**
   * The blocks each token the stream kept was drawn as. A kept token is the same object from one
   * chunk to the next, so its blocks are not converted or compared again; a source lexed whole
   * makes new tokens, and so new blocks.
   */
  private readonly streamed = new WeakMap<Token, readonly MarkdownBlock[]>();

  /** The document's blocks, with each one that did not change kept, so it is not drawn again. */
  protected readonly blocks = linkedSignal({
    source: () => {
      const tokens = this.tokens();
      if (tokens) return { tokens, streamed: false };
      const streamed = this.streaming();
      return { tokens: this.lex(this.source() ?? '', streamed), streamed };
    },
    computation: ({ tokens, streamed }, previous?: { value: readonly MarkdownBlock[] }) =>
      streamed
        ? this.streamedBlocks(tokens, previous?.value)
        : shareBlocks(previous?.value, markdownBlocks(tokens)),
  });

  private readonly classOf = computed(() => ({ ...DEFAULT_CLASSES, ...this.classes() }));

  /**
   * Each image's own width and its width over its height, once it has loaded, so it is drawn at its
   * own size and shape, as a browser draws it, and no wider than the document. The width reaches
   * the image as `--md-img-width`, which `.md-img` reads, so a class of the app's own still sets
   * the width. An image the document no longer has is forgotten when the document changes.
   */
  protected readonly sizes = linkedSignal<readonly MarkdownBlock[], ReadonlyMap<string, ImageSize>>(
    {
      source: this.blocks,
      computation: (blocks, previous) => {
        const kept = new Map<string, ImageSize>();
        if (!previous) return kept;
        const present = new Set([...imageBlocks(blocks)].map((block) => block.src));
        for (const [src, size] of previous.value) if (present.has(src)) kept.set(src, size);
        return kept;
      },
    },
  );

  /**
   * The width each image is laid out at where that is less than its own, narrowed by
   * `max-width`. Yoga takes an image's height from its width before `max-width` narrows it, where
   * CSS takes it after, so a narrowed image is given the height its ratio makes of the width it
   * has. An image no longer in the document is forgotten when the document changes.
   */
  protected readonly narrowed = linkedSignal<
    readonly MarkdownBlock[],
    ReadonlyMap<ImageBlock, number>
  >({
    source: this.blocks,
    computation: (blocks, previous) => {
      const kept = new Map<ImageBlock, number>();
      if (!previous) return kept;
      const present = imageBlocks(blocks);
      for (const [block, width] of previous.value) if (present.has(block)) kept.set(block, width);
      return kept;
    },
  });

  private lex(source: string, streaming: boolean): readonly Token[] {
    return streaming ? this.stream.lex(source) : lexer(source);
  }

  /** `tokens`' blocks, converting and sharing only those of tokens the stream had not kept. */
  private streamedBlocks(
    tokens: readonly Token[],
    previous: readonly MarkdownBlock[] | undefined,
  ): readonly MarkdownBlock[] {
    const kept: MarkdownBlock[] = [];
    let at = 0;
    for (; at < tokens.length; at++) {
      const blocks = this.streamed.get(tokens[at]!);
      if (!blocks) break;
      kept.push(...blocks);
    }
    const rest = tokens.slice(at);
    const converted = rest.map((token) => markdownBlocks([token]));
    // The blocks drawn after the kept ones, when those are still the ones drawn first.
    const drawn = !kept.length || previous?.[kept.length - 1] === kept.at(-1);
    const was = drawn ? previous?.slice(kept.length) : undefined;
    const shared = shareBlocks(was, converted.flat());
    let from = 0;
    rest.forEach((token, i) => {
      const count = converted[i]!.length;
      this.streamed.set(token, shared.slice(from, (from += count)));
    });
    return [...kept, ...shared];
  }

  protected classFor(element: MarkdownElement): string {
    return this.classOf()[element];
  }

  protected imageWidth(src: string): string | null {
    const size = this.sizes().get(src);
    return size ? `${size.width}px` : null;
  }

  /** The class's height until the image loads, then its ratio's, or a narrowed image's own. */
  protected imageHeight(block: ImageBlock): number | 'auto' | null {
    const size = this.sizes().get(block.src);
    if (!size) return null;
    const width = this.narrowed().get(block);
    return width === undefined ? 'auto' : width / size.ratio;
  }

  protected layOutImage(block: ImageBlock, event: Partial<LayoutEvent>): void {
    const width = event.nativeEvent?.layout?.width;
    const size = this.sizes().get(block.src);
    if (width === undefined || !size) return;
    const narrowed = width < size.width ? width : undefined;
    if (this.narrowed().get(block) === narrowed) return;
    this.narrowed.update((all) => {
      const next = new Map(all);
      if (narrowed === undefined) next.delete(block);
      else next.set(block, narrowed);
      return next;
    });
  }

  protected sizeImage(src: string, event: Partial<ImageLoadEvent>): void {
    const source = event.nativeEvent?.source;
    if (!source) return;
    const { width, height } = source;
    if (!(width > 0 && height > 0)) return;
    // A url's or a data url's scale is 1, so the load event's pixels are the points a browser's
    // CSS pixels are.
    this.sizes.update((sizes) => new Map(sizes).set(src, { width, ratio: width / height }));
  }

  protected followLink(link: MarkdownLink): void {
    let prevented = false;
    this.linkPress.emit({
      href: link.href,
      title: link.title,
      preventDefault: () => {
        prevented = true;
      },
    });
    if (!prevented && opensOnPress(link.href)) this.injector.get(DeepLinks).open(link.href);
  }
}
