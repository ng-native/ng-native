import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  userEvent,
  type FakeFabricNode,
} from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanGroups } from './spartan-groups.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanGroups, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const finger = (pageX: number, pageY: number, down = true) => {
  const point = { identifier: 0, pageX, pageY, locationX: 0, locationY: 0 };
  return { ...point, touches: down ? [point] : [], changedTouches: [point] };
};
const hold = async (ms: number) => {
  const trigger = screen.getByTestId('context-trigger');
  await fireEvent(trigger, 'touchStart', finger(120, 400));
  await new Promise((resolve) => setTimeout(resolve, ms));
  await fireEvent(trigger, 'touchEnd', finger(120, 400, false));
  await settle();
};

test('a button group is a row of buttons with no border between them', async () => {
  await mount();
  expect(screen.getByTestId('button-group').props).toMatchObject({ flexDirection: 'row' });
  expect(screen.getByTestId('group-first').props['borderStartWidth'] ?? 1).toBe(1);
  expect(screen.getByTestId('group-middle').props).toMatchObject({ borderStartWidth: 0 });
  expect(screen.getByTestId('group-last').props).toMatchObject({ borderStartWidth: 0 });
});

// The inner corners are squared with a logical radius, `rounded-e-none`, set after the physical
// one `rounded-md` sets: the cascade hands on the later of the two alone.
test('a button group squares the corners its buttons meet at', async () => {
  await mount();
  const [first, middle, last] = ['first', 'middle', 'last'].map(
    (name) => screen.getByTestId(`group-${name}`).props,
  );
  expect(first!['borderStartEndRadius']).toBe(0);
  expect(first!['borderTopRightRadius'] ?? 0).toBe(0);
  expect(first!['borderTopLeftRadius']).toBeGreaterThan(0);
  expect(middle!['borderTopLeftRadius'] ?? 0).toBe(0);
  expect(middle!['borderTopRightRadius'] ?? 0).toBe(0);
  expect(last!['borderTopLeftRadius'] ?? 0).toBe(0);
  expect(last!['borderTopRightRadius']).toBeGreaterThan(0);
});

test('an input group is a field and what is added to it, in one bordered row', async () => {
  await mount();
  expect(screen.getByTestId('input-group').props).toMatchObject({
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    height: 36,
  });
  const field = screen.getByTestId('input-group-input');
  expect(field.viewName).toBe('TextInput');
  expect(field.props).toMatchObject({ placeholder: 'example.com', flexGrow: 1 });
  expect(screen.getByText('https://').props['color']).toBe('rgb(106, 114, 130)');
});

test('a finger held on the area opens its context menu at the finger', async () => {
  const app = await mount();
  await hold(550);
  expect(screen.getByText('Back')).toBeTruthy();
  const pane = all(app.fabric.committed[1]).find((node) => node.props['top'] === 400);
  expect(pane?.props).toMatchObject({ position: 'absolute', top: 400, left: 120 });
  await userEvent.press(screen.getByTestId('context-back'));
  await settle();
  expect(screen.getByText('Press and hold here: back')).toBeTruthy();
  expect(screen.queryByText('Reload')).toBeNull();
});

test('a press on the area opens nothing', async () => {
  await mount();
  await hold(0);
  expect(screen.queryByText('Back')).toBeNull();
});
