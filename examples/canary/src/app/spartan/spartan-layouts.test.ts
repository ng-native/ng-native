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
import { SpartanLayouts } from './spartan-layouts.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanLayouts, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const muted = 'rgb(106, 114, 130)';

test('a field stacks its label, its control and its description, and the label names the control', async () => {
  await mount();
  expect(screen.getByTestId('field').props).toMatchObject({ flexDirection: 'column', rowGap: 12 });
  expect(screen.getByText('Email').props).toMatchObject({ fontWeight: '500', fontSize: 14 });
  expect(screen.getByText('We only use it to sign you in.').props['color']).toBe(muted);
  const input = screen.getByTestId('field').children[1]!;
  expect(input.props).toMatchObject({
    keyboardType: 'email-address',
    accessibilityLabel: 'Email',
    placeholder: 'you@example.com',
  });
});

test('an item is a bordered row: its content takes the room, its actions sit at the end', async () => {
  await mount();
  const item = screen.getByTestId('item');
  expect(item.props).toMatchObject({
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
  });
  const [content, actions] = item.children;
  expect(content!.props).toMatchObject({ flexGrow: 1, flexDirection: 'column' });
  expect(actions!.props).toMatchObject({ flexDirection: 'row' });
  expect(screen.getByText('Verify with a code from your phone.').props).toMatchObject({
    color: muted,
    numberOfLines: 2,
  });
});

test('an empty state centres a title, a description and what to do next', async () => {
  await mount();
  expect(screen.getByTestId('empty').props).toMatchObject({
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  });
  expect(screen.getByText('No projects yet').props).toMatchObject({
    textAlign: 'center',
    fontSize: 18,
  });
});

test('an aspect ratio keeps the shape it is given', async () => {
  await mount();
  expect(screen.getByTestId('ratio').props['aspectRatio']).toBeCloseTo(16 / 9);
});
