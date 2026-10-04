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
import { SpartanPrompts } from './spartan-prompts.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanPrompts, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const state = () => screen.getByTestId('prompt-state').children[0]!.props['text'];
const closed = () => new Promise((resolve) => setTimeout(resolve, 400));
const open = async () => {
  const app = await mount();
  await userEvent.press(screen.getByTestId('alert-dialog-trigger'));
  await settle();
  return app;
};

test('an alert dialog opens in the middle of the screen, over a backdrop', async () => {
  const app = await open();
  expect(screen.getByText('Are you absolutely sure?').props).toMatchObject({
    accessibilityRole: 'header',
    textAlign: 'center',
  });
  expect(screen.getByTestId('alert-dialog').props).toMatchObject({
    backgroundColor: 'rgb(255, 255, 255)',
    maxWidth: 320,
  });
  const overlay = all(app.fabric.committed[1]);
  expect(overlay.some((node) => node.props['role'] === 'alertdialog')).toBe(true);
  expect(
    overlay.some(
      (node) => node.props['justifyContent'] === 'center' && node.props['alignItems'] === 'center',
    ),
  ).toBe(true);
});

test('its action runs and closes it, and its cancel only closes it', async () => {
  await open();
  await userEvent.press(screen.getByTestId('alert-dialog-action'));
  await closed();
  expect(state()).toBe('Deleted: 1, code: none');
  expect(screen.queryByText('Are you absolutely sure?')).toBeNull();
  await userEvent.press(screen.getByTestId('alert-dialog-trigger'));
  await settle();
  await userEvent.press(screen.getByTestId('alert-dialog-cancel'));
  await closed();
  expect(state()).toBe('Deleted: 1, code: none');
  expect(screen.queryByText('Are you absolutely sure?')).toBeNull();
});

test('a press on the backdrop leaves an alert dialog open: it wants an answer', async () => {
  const app = await open();
  const backdrop = all(app.fabric.committed[1]).find(
    (node) => node.props['backgroundColor'] === 'rgba(0, 0, 0, 0.1)',
  )!;
  await userEvent.press(backdrop);
  await closed();
  expect(screen.getByText('Are you absolutely sure?')).toBeTruthy();
});

test('a one-time code is typed on a number pad into one field, drawn a character a slot', async () => {
  await mount();
  const field = all(screen.getByTestId('otp')).find((node) => node.viewName === 'TextInput')!;
  expect(field.props).toMatchObject({
    keyboardType: 'number-pad',
    textContentType: 'oneTimeCode',
  });
  await userEvent.type(field, '12');
  await settle();
  expect(state()).toBe('Deleted: 0, code: 12');
  const slots = screen.getByTestId('otp').children[0]!.children;
  expect(slots).toHaveLength(4);
  const drawn = slots.map((slot) =>
    all(slot)
      .filter((node) => node.viewName === 'RawText')
      .map((node) => node.props['text'])
      .join(''),
  );
  expect(drawn.map((text) => text.trim())).toEqual(['1', '2', '', '']);
});
