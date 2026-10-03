/**
 * The tab a page is in, for a stack inside it to hear when another tab comes in front.
 *
 * A sheet or a modal presented in a tab's own stack is shown over the whole window, the tab bar
 * included, so the tab cannot keep it up while it is behind: it would cover the tab in front. The
 * tab's stacks dismiss what they presented instead, and the tab is remembered at the page beneath.
 */
import { InjectionToken } from '@angular/core';

export interface InTab {
  /**
   * Runs `leave` each time another tab of the bar comes in front of this one. `leave` answers the
   * url the tab is left on once it has dismissed what it presented, or null when it dismissed
   * nothing. Answers the unsubscribe.
   */
  onLeave(leave: () => string | null): () => void;
}

export const IN_TAB = new InjectionToken<InTab>('ng-native.router.in-tab');
