import {
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
  numberAttribute,
  output,
  viewChild,
} from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';
import { TemplateSlot } from './template-slot.ts';
import { optionalBoolean } from './transforms.ts';
import { View } from './view.ts';
import type { KeyboardShouldPersistTaps } from './keyboard-taps.ts';
import { VirtualList, type VirtualListPadding } from './virtual-list.ts';

/** A section as RN's SectionList takes it: its rows in `data`, plus whatever else it carries. */
export interface SectionListSection<T> {
  readonly key?: string;
  readonly title?: string;
  readonly data: readonly T[];
}

/** What a section header or footer template is given. */
export interface SectionContext<S> {
  readonly $implicit: S;
  readonly section: S;
  readonly sectionIndex: number;
}

/** What an item template is given. `index` counts within the section, as `renderItem` does. */
export interface SectionItemContext<T, S> {
  readonly $implicit: T;
  readonly item: T;
  readonly index: number;
  readonly section: S;
  readonly sectionIndex: number;
}

/** What a separator template is given: the items either side of it, in the same section. */
export interface SectionSeparatorContext<T, S> {
  readonly $implicit: T;
  readonly leadingItem: T;
  readonly trailingItem: T;
  readonly section: S;
}

/**
 * What a section separator template is given: the section, and what is either side of the edge
 * it sits at. At a section's start `leadingItem` is undefined, and at its end `trailingItem` is.
 */
export interface SectionEdgeSeparatorContext<T, S> {
  readonly $implicit: S;
  readonly section: S;
  readonly leadingItem: T | undefined;
  readonly leadingSection: S | undefined;
  readonly trailingItem: T | undefined;
  readonly trailingSection: S | undefined;
}

/** `<ng-template sectionHeader let-section>`: RN's `renderSectionHeader`. */
@Directive({ selector: 'ng-template[sectionHeader]' })
export class SectionHeader<S = unknown> {
  readonly template = inject<TemplateRef<SectionContext<S>>>(TemplateRef);

  static ngTemplateContextGuard<S>(
    _directive: SectionHeader<S>,
    context: unknown,
  ): context is SectionContext<S> {
    return true;
  }
}

/** `<ng-template sectionFooter let-section>`: RN's `renderSectionFooter`. */
@Directive({ selector: 'ng-template[sectionFooter]' })
export class SectionFooter<S = unknown> {
  readonly template = inject<TemplateRef<SectionContext<S>>>(TemplateRef);

  static ngTemplateContextGuard<S>(
    _directive: SectionFooter<S>,
    context: unknown,
  ): context is SectionContext<S> {
    return true;
  }
}

/** `<ng-template sectionItem let-item let-index="index">`: RN's `renderItem`. */
@Directive({ selector: 'ng-template[sectionItem]' })
export class SectionItem<T = unknown, S = unknown> {
  readonly template = inject<TemplateRef<SectionItemContext<T, S>>>(TemplateRef);

  static ngTemplateContextGuard<T, S>(
    _directive: SectionItem<T, S>,
    context: unknown,
  ): context is SectionItemContext<T, S> {
    return true;
  }
}

/** `<ng-template sectionSeparator let-leading>`: RN's `ItemSeparatorComponent`. */
@Directive({ selector: 'ng-template[sectionSeparator]' })
export class SectionSeparator<T = unknown, S = unknown> {
  readonly template = inject<TemplateRef<SectionSeparatorContext<T, S>>>(TemplateRef);

  static ngTemplateContextGuard<T, S>(
    _directive: SectionSeparator<T, S>,
    context: unknown,
  ): context is SectionSeparatorContext<T, S> {
    return true;
  }
}

/**
 * `<ng-template sectionEdgeSeparator let-section>`: RN's `SectionSeparatorComponent`, drawn at
 * both edges of a section that has items, between its header and first item and between its
 * last item and footer.
 */
@Directive({ selector: 'ng-template[sectionEdgeSeparator]' })
export class SectionEdgeSeparator<T = unknown, S = unknown> {
  readonly template = inject<TemplateRef<SectionEdgeSeparatorContext<T, S>>>(TemplateRef);

  static ngTemplateContextGuard<T, S>(
    _directive: SectionEdgeSeparator<T, S>,
    context: unknown,
  ): context is SectionEdgeSeparatorContext<T, S> {
    return true;
  }
}

/** One row of the flattened list. */
export type SectionRow<T, S> =
  | {
      readonly kind: 'header' | 'footer';
      readonly context: SectionContext<S>;
      readonly separator: null;
      readonly leading: null;
      readonly trailing: null;
    }
  | {
      readonly kind: 'item';
      readonly context: SectionItemContext<T, S>;
      /** Null for a section's last item, where the section separator takes its place, as in RN. */
      readonly separator: SectionSeparatorContext<T, S> | null;
      /** The section separator before a section's first item, and null on every other. */
      readonly leading: SectionEdgeSeparatorContext<T, S> | null;
      /** The section separator after a section's last item, and null on every other. */
      readonly trailing: SectionEdgeSeparatorContext<T, S> | null;
    };

/**
 * Flatten sections into the rows RN's `VirtualizedSectionList` gives its list: for each section a
 * header, its items, then a footer. The header and footer rows are there whether or not anything
 * is drawn in them, as in RN, which is what keeps `scrollToLocation`'s arithmetic the same.
 *
 * The section separators ride on the first and last item, as RN's do: `SectionSeparatorComponent`
 * is the first item's leading separator and the last item's trailing one, so an empty section has
 * none, and a last item has it in place of the item separator.
 */
export function flattenSections<T, S extends SectionListSection<T>>(
  sections: readonly S[],
): SectionRow<T, S>[] {
  const rows: SectionRow<T, S>[] = [];
  const edges = { leading: null, trailing: null };
  sections.forEach((section, sectionIndex) => {
    const context = { $implicit: section, section, sectionIndex };
    rows.push({ kind: 'header', context, separator: null, ...edges });
    const data = section.data;
    const last = data.length - 1;
    const around = {
      $implicit: section,
      section,
      leadingSection: sections[sectionIndex - 1],
      trailingSection: sections[sectionIndex + 1],
    };
    data.forEach((item, index) => {
      const trailingItem = data[index + 1];
      rows.push({
        kind: 'item',
        context: { $implicit: item, item, index, section, sectionIndex },
        separator:
          index < last
            ? { $implicit: item, leadingItem: item, trailingItem: trailingItem!, section }
            : null,
        leading: index === 0 ? { ...around, leadingItem: undefined, trailingItem: item } : null,
        trailing: index === last ? { ...around, leadingItem: item, trailingItem: undefined } : null,
      });
    });
    rows.push({ kind: 'footer', context, separator: null, ...edges });
  });
  return rows;
}

type Height<A extends unknown[]> = number | ((...args: A) => number);

const measure = <A extends unknown[]>(height: Height<A>, ...args: A): number =>
  typeof height === 'number' ? height : height(...args);

/**
 * RN's SectionList: sections of items, each with a header and footer, over `<virtual-list>`.
 *
 * RN's own is a VirtualizedList over flattened rows, and so is this. Sections become one list of
 * header, item and footer rows, the rows are placed by `<virtual-list>`'s variable-height windowing,
 * and this component draws each from the caller's templates:
 *
 * ```html
 * <section-list [sections]="sections" [itemHeight]="44" [sectionHeaderHeight]="28">
 *   <ng-template sectionHeader let-section><text>{{ section.title }}</text></ng-template>
 *   <ng-template sectionItem let-item><text>{{ item }}</text></ng-template>
 *   <ng-template sectionSeparator><view [style]="line"></view></ng-template>
 *   <ng-template sectionEdgeSeparator><view [style]="rule"></view></ng-template>
 * </section-list>
 * ```
 *
 * Rows are fixed height, as `getItemLayout` makes them in RN: `itemHeight`, `sectionHeaderHeight`
 * and `sectionFooterHeight` are numbers or functions. An item's height includes its separators,
 * which are drawn in the item's slot: the item separator at its bottom, only between items of the
 * same section, and the section separator at the top of a section's first item and the bottom of
 * its last, as RN's `SectionSeparatorComponent` is.
 *
 * `stickySectionHeadersEnabled` pins the current section's header until the next pushes it off.
 * It defaults to on for iOS and off for Android, as RN's does. `listHeader` and `listFooter`
 * content and a `<refresh-control>` pass through to the list.
 *
 * `contentPadding` and `keyboardShouldPersistTaps` pass through to the list as `<virtual-list>`
 * takes them.
 *
 * ponytail: no `horizontal` or `inverted`, no viewability events, and no `highlighted` on a
 * separator. No `keyExtractor` or `maintainVisibleContentPosition` either: rows are fixed height,
 * so there is no measured height for a key to carry across an insert. The host is a plain view
 * with the list filling it, where RN's host is the scroll view, so scroll-view props are not
 * taken.
 */
@Component({
  selector: 'section-list',
  exportAs: 'sectionList',
  imports: [TemplateSlot, View, VirtualList],
  template: `
    <virtual-list
      #list
      [items]="rows()"
      [itemHeight]="rowHeight"
      [stickyIndices]="stickyRows()"
      [overscan]="overscan()"
      [endReachedThreshold]="endReachedThreshold()"
      [contentPadding]="contentPadding()"
      [keyboardShouldPersistTaps]="keyboardShouldPersistTaps()"
      [style]="fill"
      (endReached)="endReached.emit($event)"
    >
      <ng-content select="refresh-control" ngProjectAs="refresh-control" />
      <view listHeader><ng-content select="[listHeader]" /></view>
      <ng-content />
      @for (row of list.window(); track row.index) {
        <view [style]="row.style">
          @switch (row.item.kind) {
            @case ('header') {
              @if (header(); as header) {
                <ng-container
                  [templateSlot]="header.template"
                  [templateSlotContext]="row.item.context"
                />
              }
            }
            @case ('footer') {
              @if (footer(); as footer) {
                <ng-container
                  [templateSlot]="footer.template"
                  [templateSlotContext]="row.item.context"
                />
              }
            }
            @case ('item') {
              @if (row.item.leading; as start) {
                @if (edge(); as edge) {
                  <ng-container [templateSlot]="edge.template" [templateSlotContext]="start" />
                }
              }
              <view [style]="cell">
                @if (item(); as item) {
                  <ng-container
                    [templateSlot]="item.template"
                    [templateSlotContext]="row.item.context"
                  />
                }
              </view>
              @if (separator(); as separator) {
                @if (row.item.separator; as gap) {
                  <ng-container [templateSlot]="separator.template" [templateSlotContext]="gap" />
                }
              }
              @if (row.item.trailing; as end) {
                @if (edge(); as edge) {
                  <ng-container [templateSlot]="edge.template" [templateSlotContext]="end" />
                }
              }
            }
          }
        </view>
      }
      <view listFooter><ng-content select="[listFooter]" /></view>
    </virtual-list>
  `,
})
export class SectionList<T, S extends SectionListSection<T> = SectionListSection<T>> {
  readonly sections = input.required<readonly S[]>();
  /** Each item's height, including every separator drawn in its slot. */
  readonly itemHeight = input.required<Height<[item: T, index: number, section: S]>>();
  readonly sectionHeaderHeight = input<Height<[section: S]>>(0);
  readonly sectionFooterHeight = input<Height<[section: S]>>(0);
  /** Pin the current section's header. Defaults to true on iOS and false on Android, as RN. */
  readonly stickySectionHeadersEnabled = input(undefined, { transform: optionalBoolean });
  readonly overscan = input(4, { transform: numberAttribute });
  readonly endReachedThreshold = input(2, { transform: numberAttribute });
  /** Space around the rows, inside the scrolling content. See `<virtual-list>`. */
  readonly contentPadding = input<VirtualListPadding>(0);
  /** What a tap in the list does while a text input has the keyboard up. See `ScrollView`. */
  readonly keyboardShouldPersistTaps = input<KeyboardShouldPersistTaps>('never');

  /** The end of the last section is within `endReachedThreshold`. See `<virtual-list>`. */
  readonly endReached = output<{ distanceFromEnd: number }>();

  protected readonly header = contentChild<SectionHeader<S>>(SectionHeader);
  protected readonly footer = contentChild<SectionFooter<S>>(SectionFooter);
  protected readonly item = contentChild<SectionItem<T, S>>(SectionItem);
  protected readonly separator = contentChild<SectionSeparator<T, S>>(SectionSeparator);
  protected readonly edge = contentChild<SectionEdgeSeparator<T, S>>(SectionEdgeSeparator);
  private readonly list = viewChild.required<VirtualList<SectionRow<T, S>>>('list');

  protected readonly fill = { flex: 1 };
  /** The item fills its slot between its separators, as RN's cell draws them around it. */
  protected readonly cell = { flex: 1 };

  protected readonly rows = computed(() => flattenSections<T, S>(this.sections()));

  private readonly sticky = computed(
    () => this.stickySectionHeadersEnabled() ?? nativePlatform() === 'ios',
  );

  /** The header rows, pinned in turn, when headers stick and there is a header to draw. */
  protected readonly stickyRows = computed(() => {
    if (!this.sticky() || !this.header()) return [];
    const indices: number[] = [];
    this.rows().forEach((row, index) => {
      if (row.kind === 'header') indices.push(index);
    });
    return indices;
  });

  protected readonly rowHeight = (row: SectionRow<T, S>): number => {
    const { section } = row.context;
    if (row.kind === 'item') {
      return measure(this.itemHeight(), row.context.item, row.context.index, section);
    }
    return row.kind === 'header'
      ? measure(this.sectionHeaderHeight(), section)
      : measure(this.sectionFooterHeight(), section);
  };

  /**
   * Scroll to an item, RN's way: `itemIndex` 0 is the section's header and 1 its first item, and
   * with sticky headers the header's height is allowed for so the item is not hidden under it.
   */
  scrollToLocation(options: {
    sectionIndex: number;
    itemIndex: number;
    viewOffset?: number;
    animated?: boolean;
  }): void {
    const sections = this.sections();
    let index = options.itemIndex;
    for (let i = 0; i < options.sectionIndex; i++) index += sections[i]!.data.length + 2;
    let viewOffset = options.viewOffset ?? 0;
    const section = sections[options.sectionIndex];
    if (options.itemIndex > 0 && this.sticky() && section) {
      viewOffset += measure(this.sectionHeaderHeight(), section);
    }
    this.list().scrollToIndex({ index, viewOffset, animated: options.animated });
  }
}
