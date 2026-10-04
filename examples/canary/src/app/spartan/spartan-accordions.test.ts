import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  userEvent,
  type FakeFabricNode,
} from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanAccordions } from './spartan-accordions.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

let fabric: Awaited<ReturnType<typeof render>>['fabric'] | undefined;
const mount = async () => {
  const app = await render(SpartanAccordions, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat()],
  });
  fabric = app.fabric;
  return app;
};
const mountedFabric = async () => fabric!;

const trigger = (id: string): FakeFabricNode => {
  const find = (node: FakeFabricNode): FakeFabricNode | undefined =>
    node.props['accessibilityRole'] === 'button' ? node : node.children.map(find).find(Boolean);
  return find(screen.getByTestId(id))!;
};

test('each item is a header that is a button, over a closed panel, with a rule between items', async () => {
  await mount();
  expect(trigger('first').props).toMatchObject({
    accessibilityState: { expanded: false },
    flexDirection: 'row',
    paddingTop: 16,
    paddingBottom: 16,
  });
  expect(screen.getByText('Is it accessible?')).toBeTruthy();
  expect(screen.getByTestId('first-item').props).toMatchObject({
    borderBottomWidth: 1,
    borderBottomColor: 'rgb(229, 231, 235)',
  });
  expect(screen.getByTestId('second-item').props['borderBottomWidth'] ?? 0).toBe(0);
  expect(screen.getByTestId('first-content').props).toMatchObject({
    height: 0,
    overflow: 'hidden',
  });
});

test('a press on a header marks it expanded, and a press on another closes it', async () => {
  await mount();
  await userEvent.press(trigger('first'));
  expect(trigger('first').props).toMatchObject({ accessibilityState: { expanded: true } });
  await userEvent.press(trigger('second'));
  expect(trigger('second').props).toMatchObject({ accessibilityState: { expanded: true } });
  expect(trigger('first').props).toMatchObject({ accessibilityState: { expanded: false } });
});

// What the package does with a measurement, not what a device measures: there the content of a
// closed panel is laid out at its padding alone, so the panel opens to that. See the page.
test('an open panel is as tall as the content native laid out in it', async () => {
  await mount();
  const inner = screen.getByTestId('first-content').children[0] as FakeFabricNode;
  // What a device reports once the panel's content has been laid out.
  (await mountedFabric()).frames.set('View', { x: 0, y: 0, width: 300, height: 40 });
  await fireEvent.layout(inner, { width: 300, height: 40 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await userEvent.press(trigger('first'));
  await vi.waitFor(() => expect(screen.getByTestId('first-content').props['height']).toBe(40));
});
