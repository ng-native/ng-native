/**
 * The header's native bar button items: what the `native-header-item`s written in a header that
 * are buttons rather than views give it to commit.
 *
 * react-native-screens takes a bar button item as data, an entry in the header config's
 * `headerLeftBarButtonItems` or `headerRightBarButtonItems`, not as a child view, so each such item
 * registers here and the header commits the lists. `RNSScreenStackHeaderConfig.mm` puts the custom
 * view items of a side first, in the order they were committed, then each entry at its `index`,
 * so an entry's index is its place among every item of its side as written, views included.
 */
import { computed, signal, type Provider, type Signal } from '@angular/core';
import type { EngineNode } from '@ng-native/fabric';

/** What native reads of one bar button item, as `RNSBarButtonItem.mm` reads it. */
export type BarButtonConfig = Readonly<Record<string, unknown>>;

/** One header item, as the header sees it. */
export interface HeaderBarEntry {
  readonly node: EngineNode;
  /** `left` or `right` for an item in a side, null for one anywhere else. */
  readonly side: Signal<'left' | 'right' | null>;
  /** Whether the item is left out of the bar. */
  readonly hidden: Signal<boolean>;
  /** The item's config while it is a bar button, null while it is a custom view. */
  readonly button: Signal<BarButtonConfig | null>;
  readonly press: () => void;
}

/** One per header, which provides it to the items written in it. */
export class HeaderBarButtons {
  private readonly entries = signal<readonly HeaderBarEntry[]>([]);
  /** Counts the moves `noteOrder` found, which nothing else about the tree tells a signal of. */
  private readonly moves = signal(0);
  /** The entries as last read from the tree. */
  private readonly written = computed(() => {
    this.moves();
    return inTreeOrder(this.entries());
  });

  /** `headerLeftBarButtonItems`, or undefined when the side has none. */
  readonly left = computed(() => this.side('left'));
  /** `headerRightBarButtonItems`, or undefined when the side has none. */
  readonly right = computed(() => this.side('right'));

  /** Adds an item, and answers what takes it away again. */
  add(entry: HeaderBarEntry): () => void {
    this.entries.update((all) => [...all, entry]);
    return () => this.entries.update((all) => all.filter((each) => each !== entry));
  }

  /**
   * Reads the entries' order again, for after a render. A `@for` moves an item without touching
   * anything the lists depend on, and one inside a component of the header moves it after the
   * header's bindings have run. The lists change only for a move: a new list is a new prop, and
   * native builds the bar's items again from it.
   */
  noteOrder(): void {
    if (!this.left() && !this.right()) return;
    const written = this.written();
    if (inTreeOrder(written).some((entry, i) => entry !== written[i])) {
      this.moves.update((moves) => moves + 1);
    }
  }

  /** Tells the item native names that it was tapped. An event with no id names none. */
  pressed(buttonId: unknown): void {
    if (typeof buttonId !== 'string') return;
    this.entries()
      .find((entry) => entry.button()?.['buttonId'] === buttonId)
      ?.press();
  }

  private side(side: 'left' | 'right'): BarButtonConfig[] | undefined {
    const items: BarButtonConfig[] = [];
    let index = 0;
    for (const entry of this.written()) {
      if (entry.side() !== side || entry.hidden()) continue;
      const button = entry.button();
      if (button) items.push({ ...button, index });
      index++;
    }
    return items.length ? items : undefined;
  }
}

/** A header's own registry. A factory, so this file has no decorator for Node to strip. */
export const HEADER_BAR_BUTTONS: Provider = {
  provide: HeaderBarButtons,
  useFactory: () => new HeaderBarButtons(),
};

/** The entries in the order their nodes are written, as the header commits its custom views. */
function inTreeOrder(entries: readonly HeaderBarEntry[]): HeaderBarEntry[] {
  const paths = new Map(entries.map((entry) => [entry, pathOf(entry.node)]));
  return [...entries].sort((a, b) => comparePaths(paths.get(a)!, paths.get(b)!));
}

/** Each node's index in its parent, from the root down. */
function pathOf(node: EngineNode): number[] {
  const path: number[] = [];
  for (let at = node; at.parent; at = at.parent) path.unshift(at.parent.childList.indexOf(at));
  return path;
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}
