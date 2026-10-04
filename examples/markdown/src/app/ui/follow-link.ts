import type { MarkdownLinkPress } from '@ng-native/components/markdown';
import type { NativeNavigation } from '@ng-native/router';

/** A relative link in a note, pushed in the app; an absolute one is left to open outside it. */
export function followLink(navigation: NativeNavigation, link: MarkdownLinkPress): void {
  if (!link.href.startsWith('/')) return;
  link.preventDefault();
  void navigation.push(link.href);
}
