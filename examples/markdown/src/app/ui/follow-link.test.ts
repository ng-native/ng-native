import type { MarkdownLinkPress } from '@ng-native/components/markdown';
import type { NativeNavigation } from '@ng-native/router';
import { expect, test } from 'vitest';
import { followLink } from './follow-link.ts';

function press(href: string) {
  const pushed: string[] = [];
  let prevented = false;
  const navigation = {
    push: async (url: string) => void pushed.push(url),
  } as unknown as NativeNavigation;
  const link: MarkdownLinkPress = { href, title: null, preventDefault: () => (prevented = true) };
  followLink(navigation, link);
  return { pushed, prevented };
}

test('pushes a path in the app, and leaves an absolute or protocol-relative link alone', () => {
  expect(press('/about')).toEqual({ pushed: ['/about'], prevented: true });
  expect(press('//example.com/a')).toEqual({ pushed: [], prevented: false });
  expect(press('https://example.com')).toEqual({ pushed: [], prevented: false });
});
