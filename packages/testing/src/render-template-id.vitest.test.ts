/**
 * `render()` with a template string, more than once in a file.
 *
 * Each call compiles a host component of its own. Angular derives a component's ID from its
 * metadata, not its template's text, so wrappers alike in shape took one ID and logged NG0912 from
 * the second render on.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { Text } from '@ng-native/components';
import { cleanup, render, screen } from '@ng-native/testing';

afterEach(cleanup);

test('renders a template string again without an ID collision', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await render('<text>a</text>', { imports: [Text] });
  expect(screen.getByText('a')).toBeTruthy();
  cleanup();
  await render('<text>b</text>', { imports: [Text] });
  expect(screen.getByText('b')).toBeTruthy();
  const collisions = warn.mock.calls.filter((call) => String(call[0]).includes('NG0912'));
  warn.mockRestore();
  expect(collisions).toEqual([]);
});
