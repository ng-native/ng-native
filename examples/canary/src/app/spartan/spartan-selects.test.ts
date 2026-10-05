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
import { SpartanSelects } from './spartan-selects.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanSelects, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const trigger = () => screen.getByRole('combobox');
const muted = 'rgb(106, 114, 130)';

test('a select shows its placeholder, muted, until something is chosen', async () => {
  await mount();
  // The chevron, drawn natively at the size its font size gives it.
  const chevron = all(trigger()).find((node) => node.viewName === 'RNSVGSvgView')!;
  expect(all(chevron).some((node) => node.viewName === 'RNSVGPath')).toBe(true);
  expect(chevron.props['color']).toBe(muted);
  expect(screen.getByText('Select a fruit').props['color']).toBe(muted);
  expect(trigger().props).toMatchObject({ flexDirection: 'row', borderTopWidth: 1, height: 36 });
  expect(screen.queryByText('Banana')).toBeNull();
});

test('pressing the trigger lists the options, as wide as the trigger', async () => {
  const app = await mount();
  app.fabric.frames.set('fruit', { x: 16, y: 300, width: 224, height: 36 });
  // Native lays the trigger out, which is when a ResizeObserver reports its size.
  await fireEvent.layout(trigger(), { width: 224, height: 36 });
  await userEvent.press(trigger());
  await settle();
  expect(screen.getByText('Fruits').props['color']).toBe(muted);
  expect(screen.getByTestId('select-content').props).toMatchObject({
    width: 224,
    backgroundColor: 'rgb(255, 255, 255)',
  });
  // Under the trigger: the CDK's box starts at its bottom edge.
  expect(all(app.fabric.committed[1]).some((node) => node.props['top'] === 336)).toBe(true);
});

test('choosing an option shows it in the trigger, tells the model and closes the list', async () => {
  await mount();
  await userEvent.press(trigger());
  await settle();
  await userEvent.press(screen.getByTestId('select-banana'));
  await settle();
  expect(screen.getByText('Chosen: Banana')).toBeTruthy();
  expect(screen.getByText('Banana').props['color']).not.toBe(muted);
  expect(screen.queryByText('Apple')).toBeNull();
});

test('the chosen option is ticked when the list opens again', async () => {
  await mount();
  await userEvent.press(trigger());
  await settle();
  const ticks = () =>
    all(screen.getByTestId('select-content')).filter((n) => n.viewName === 'RNSVGSvgView');
  expect(ticks()).toHaveLength(0);
  await userEvent.press(screen.getByTestId('select-banana'));
  await settle();
  await userEvent.press(trigger());
  await settle();
  expect(ticks()).toHaveLength(1);
  expect(all(screen.getByTestId('select-banana')).some((n) => n.viewName === 'RNSVGSvgView')).toBe(
    true,
  );
});

test('an option that is disabled is dimmed and cannot be chosen', async () => {
  await mount();
  await userEvent.press(trigger());
  await settle();
  expect(screen.getByTestId('select-grape').props).toMatchObject({
    opacity: 0.5,
    pointerEvents: 'none',
  });
});

test('a press outside the list closes it', async () => {
  await mount();
  await userEvent.press(trigger());
  await settle();
  await userEvent.press(screen.getByTestId('select-chosen'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(screen.queryByText('Apple')).toBeNull();
  expect(screen.getByText('Chosen: nothing')).toBeTruthy();
});
