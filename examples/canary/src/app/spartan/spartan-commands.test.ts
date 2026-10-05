import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import {
  cleanup,
  render,
  screen,
  settle,
  userEvent,
  type FakeFabricNode,
} from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanCommands } from './spartan-commands.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanCommands, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const field = () => all(screen.getByTestId('command')).find((n) => n.viewName === 'TextInput')!;
const shown = () =>
  ['Calendar', 'Calculator', 'Emoji', 'Profile'].filter((name) => screen.queryByText(name));
const ran = () => screen.getByTestId('command-state').children[0]!.props['text'];

test('a command lists its items in groups under a search field, the first one selected', async () => {
  await mount();
  expect(field().props['placeholder']).toBe('Type a command or search...');
  expect(shown()).toEqual(['Calendar', 'Calculator', 'Emoji', 'Profile']);
  expect(screen.getByText('Suggestions').props).toMatchObject({ fontSize: 12 });
  const item = screen.getByText('Calendar').parent!;
  expect(item.props).toMatchObject({
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgb(243, 244, 246)',
  });
  expect(screen.getByText('Calculator').parent!.props['backgroundColor']).not.toBe(
    'rgb(243, 244, 246)',
  );
});

test('typing filters the list to what matches, and to an empty state when nothing does', async () => {
  await mount();
  await userEvent.type(field(), 'cal', { skipBlur: true });
  await settle();
  expect(shown()).toEqual(['Calendar', 'Calculator']);
  expect(screen.queryByText('Settings')).toBeNull();
  await userEvent.type(field(), 'calzz', { skipBlur: true });
  await settle();
  expect(shown()).toEqual([]);
  expect(screen.getByText('No results found.')).toBeTruthy();
});

test('pressing an item runs it, and a disabled one does not', async () => {
  await mount();
  await userEvent.press(screen.getByText('Calculator').parent!);
  await settle();
  expect(ran()).toBe('Ran: calculator');
  expect(screen.getByText('Emoji').parent!.props).toMatchObject({
    opacity: 0.5,
    pointerEvents: 'none',
  });
});
