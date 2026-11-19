/**
 * How `<virtual-list>` lays items out across its width, when a directive on the list says so.
 *
 * The list places items along its axis and windows them; how many share a line and where each
 * sits across it is a separate decision, and a list that never makes it carries none of its code.
 * A directive on the list's own element provides this, as `[contextMenu]` provides `CONTEXT_MENU`
 * to `<pressable>`, and the list reads it with `{ self: true, optional: true }`.
 */
import { InjectionToken, type Signal } from '@angular/core';

export interface VirtualListLayout {
  /** How many items go on a line. One is a plain list. */
  readonly columns: Signal<number>;
  /**
   * The props that place the item in `column` across a line, given the list's own insets on its
   * left and right. Column 0 is at the start of the line, so the props are logical sides, which
   * layout resolves by direction as React Native resolves the list's own left and right. Every
   * column's props name the same keys, so moving between columns overwrites them all.
   */
  across(column: number, left: number, right: number): Record<string, unknown>;
}

export const VIRTUAL_LIST_LAYOUT = new InjectionToken<VirtualListLayout>(
  'angular-native.virtualListLayout',
);
