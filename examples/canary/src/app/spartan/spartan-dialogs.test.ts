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
import { SpartanDialogs } from './spartan-dialogs.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanDialogs, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

/** The overlay layer: what the document's body holds, committed after the page. */
const overlay = (app: Awaited<ReturnType<typeof mount>>): FakeFabricNode | undefined =>
  app.fabric.committed[1];
const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
/** Long enough for the CDK to take a closed backdrop away, which it does on a timer. */
const closed = () => new Promise((resolve) => setTimeout(resolve, 700));

test('nothing is laid over the page until the dialog opens', async () => {
  const app = await mount();
  expect(overlay(app)).toBeUndefined();
  expect(screen.queryByText('Delete file?')).toBeNull();
});

test('opening lays a dimmed backdrop over the screen with the panel centred on it', async () => {
  const app = await mount();
  await userEvent.press(screen.getByTestId('open'));
  await settle();
  const layer = overlay(app)!;
  // The body: over the whole screen, and letting touches through where nothing is.
  expect(layer.props).toMatchObject({
    position: 'absolute',
    top: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  });
  const backdrop = all(layer).find(
    (node) => node.props['backgroundColor'] === 'rgba(0, 0, 0, 0.1)',
  );
  expect(backdrop?.props).toMatchObject({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  const wrapper = all(layer).find(
    (node) => node.props['justifyContent'] === 'center' && node.props['height'] === '100%',
  );
  expect(wrapper?.props).toMatchObject({ alignItems: 'center', width: '100%' });
  expect(screen.getByTestId('content').props).toMatchObject({
    backgroundColor: 'rgb(255, 255, 255)',
    paddingTop: 24,
    paddingLeft: 24,
  });
  expect(all(layer).find((node) => node.props['role'] === 'dialog')).toBeTruthy();
  expect(screen.getByText('Delete file?')).toBeTruthy();
  expect(screen.getByText('This cannot be undone.')).toBeTruthy();
});

test('a button that closes the dialog takes the whole overlay away, and it opens again', async () => {
  const app = await mount();
  await userEvent.press(screen.getByTestId('open'));
  await settle();
  await userEvent.press(screen.getByTestId('cancel'));
  await closed();
  await settle();
  expect(screen.queryByText('Delete file?')).toBeNull();
  expect(
    all(overlay(app)).some((node) => node.props['backgroundColor'] === 'rgba(0, 0, 0, 0.1)'),
  ).toBe(false);
  expect(screen.getByText('Deleted: 0')).toBeTruthy();

  await userEvent.press(screen.getByTestId('open'));
  await settle();
  expect(screen.getByText('Delete file?')).toBeTruthy();
});

test('a button in the dialog runs its own click as well as closing it', async () => {
  await mount();
  await userEvent.press(screen.getByTestId('open'));
  await settle();
  await userEvent.press(screen.getByTestId('delete'));
  await closed();
  await settle();
  expect(screen.getByText('Deleted: 1')).toBeTruthy();
  expect(screen.queryByText('Delete file?')).toBeNull();
});

test('a press on the backdrop closes it', async () => {
  const app = await mount();
  await userEvent.press(screen.getByTestId('open'));
  await settle();
  const backdrop = all(overlay(app)).find(
    (node) => node.props['backgroundColor'] === 'rgba(0, 0, 0, 0.1)',
  )!;
  await userEvent.press(backdrop);
  await closed();
  await settle();
  expect(screen.queryByText('Delete file?')).toBeNull();
});
