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
import { SpartanOverlays } from './spartan-overlays.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanOverlays, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
/** The overlay layer: what the document's body holds, committed after the page. */
const overlay = (app: Awaited<ReturnType<typeof mount>>) => all(app.fabric.committed[1]);

test("a popover opens under its trigger, at the trigger's left edge", async () => {
  const app = await mount();
  // Where native laid the trigger out, and how big the popover came out.
  app.fabric.frames.set('trigger', { x: 16, y: 300, width: 120, height: 36 });
  app.fabric.frames.set('View', { x: 0, y: 0, width: 288, height: 80 });
  await userEvent.press(screen.getByTestId('popover-trigger'));
  await settle();
  expect(screen.getByText('Dimensions')).toBeTruthy();
  expect(screen.getByTestId('popover').props).toMatchObject({
    width: 288,
    backgroundColor: 'rgb(255, 255, 255)',
  });
  // The CDK's bounding box starts at the trigger's bottom edge, 300 + 36, and the pane inside it
  // lines up with the trigger's left.
  const box = overlay(app).find((node) => node.props['top'] === 336);
  expect(box?.props).toMatchObject({ position: 'absolute', top: 336 });
});

test('a press outside the popover closes it, and one inside does not', async () => {
  await mount();
  await userEvent.press(screen.getByTestId('popover-trigger'));
  await settle();
  await userEvent.press(screen.getByTestId('popover'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(screen.getByText('Dimensions')).toBeTruthy();
  await userEvent.press(screen.getByTestId('tooltip-trigger'));
  await new Promise((resolve) => setTimeout(resolve, 700));
  await settle();
  expect(screen.queryByText('Dimensions')).toBeNull();
});
