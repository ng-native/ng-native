/**
 * Which of `<virtual-list>`'s rows pin at more than one level, when a directive on the list says
 * so.
 *
 * `stickyIndices` pins rows one at a time: each pushes the one before it off. A list grouped more
 * than once, days in months in years, pins a row under the rows of the groups it is in, and how
 * deep each row is comes from the items rather than from a list of indices. A directive on the
 * list's own element provides this, as `[virtualListNumColumns]` provides `VIRTUAL_LIST_LAYOUT`,
 * and the list reads it with `{ self: true, optional: true }`.
 */
import { InjectionToken, type Signal } from '@angular/core';

export interface VirtualListSticky {
  /**
   * What gives a row's level, or null when nothing does. A level is a whole number from 0, the
   * outermost; null is a row that scrolls with the rest.
   */
  readonly levelOf: Signal<((item: unknown, index: number) => number | null) | null>;
}

export const VIRTUAL_LIST_STICKY = new InjectionToken<VirtualListSticky>(
  'angular-native.virtualListSticky',
);
