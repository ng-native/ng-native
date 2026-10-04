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
import { SpartanSheets } from './spartan-sheets.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanSheets, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const open = async (side: 'right' | 'bottom') => {
  const app = await mount();
  await userEvent.press(screen.getByTestId(`sheet-${side}`));
  await settle();
  return app;
};
/** The views from the overlay layer down to the sheet, outermost first. */
const above = (app: Awaited<ReturnType<typeof mount>>): FakeFabricNode[] => {
  const path = (node: FakeFabricNode): FakeFabricNode[] | undefined => {
    if (node.props['testID'] === 'sheet') return [];
    for (const child of node.children) {
      const rest = path(child);
      if (rest) return [node, ...rest];
    }
    return undefined;
  };
  return path(app.fabric.committed[1]!)!;
};

test('a sheet from the right is three quarters of the screen wide, over a backdrop', async () => {
  const app = await open('right');
  expect(screen.getByText('Edit profile')).toBeTruthy();
  expect(screen.getByTestId('sheet').props).toMatchObject({
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '75%',
    backgroundColor: 'rgb(255, 255, 255)',
    borderLeftWidth: 1,
  });
  const backdrop = all(app.fabric.committed[1]).find(
    (node) => node.props['backgroundColor'] === 'rgba(0, 0, 0, 0.1)',
  );
  expect(backdrop?.props).toMatchObject({ position: 'absolute', top: 0, bottom: 0 });
});

test('a sheet is placed against the full-screen wrapper: nothing between them positions it', async () => {
  const app = await open('right');
  const [pane, container] = above(app).slice(-2);
  expect(pane!.props['position']).toBe('static');
  expect(container!.props['position']).toBe('static');
  expect(above(app).at(-3)!.props).toMatchObject({
    position: 'absolute',
    width: '100%',
    height: '100%',
  });
});

test('a sheet from the bottom is as wide as the screen and as tall as what it holds', async () => {
  await open('bottom');
  expect(screen.getByText('Share')).toBeTruthy();
  expect(screen.getByTestId('sheet').props).toMatchObject({
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: 'auto',
    borderTopWidth: 1,
  });
});

test('a sheet closes from a button inside it', async () => {
  await open('right');
  await userEvent.press(screen.getByTestId('sheet-save'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(screen.queryByText('Edit profile')).toBeNull();
});

test('a press on the backdrop closes the sheet', async () => {
  const app = await open('right');
  const backdrop = all(app.fabric.committed[1]).find(
    (node) => node.props['backgroundColor'] === 'rgba(0, 0, 0, 0.1)',
  )!;
  await userEvent.press(backdrop);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(screen.queryByText('Edit profile')).toBeNull();
});
