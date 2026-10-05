import type { MarkdownLinkPress } from '@ng-native/components/markdown';
import type { NativeNavigation } from '@ng-native/router';

/** A relative link in a document, pushed in the app; an absolute one is left to open outside it. */
export function followMarkdownLink(navigation: NativeNavigation, link: MarkdownLinkPress): void {
  if (!link.href.startsWith('/') || link.href.startsWith('//')) return;
  link.preventDefault();
  void navigation.push(link.href);
}
