import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, fireEvent, render, screen, type FakeFabricNode } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanBadges } from './spartan-badges.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanBadges, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

const badge = (id: string) => screen.getByTestId(id);

test('a badge on a span is one pill of text', async () => {
  await mount();
  const view = badge('default');
  expect(view.viewName).toBe('Paragraph');
  expect(view.props).toMatchObject({
    height: 20,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0)',
    overflow: 'hidden',
    numberOfLines: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: 'rgb(249, 250, 251)',
    backgroundColor: 'rgb(16, 24, 40)',
  });
  // `rounded-4xl`, 2.6 times a radius of 10: more than half the height, so the ends are round.
  expect(view.props['borderTopLeftRadius']).toBeCloseTo(26, 4);
  expect(screen.getByText('Default')).toBeTruthy();
});

test('each variant has its own colours', async () => {
  await mount();
  expect(badge('secondary').props).toMatchObject({
    backgroundColor: 'rgb(243, 244, 246)',
    color: 'rgb(16, 24, 40)',
  });
  expect(badge('outline').props).toMatchObject({
    borderTopColor: 'rgb(229, 231, 235)',
    color: 'rgb(3, 7, 18)',
  });
  expect(badge('outline').props['backgroundColor']).toBeUndefined();
  expect(badge('destructive').props).toMatchObject({
    backgroundColor: 'rgba(231, 0, 11, 0.1)',
    color: 'rgb(231, 0, 11)',
  });
  expect(badge('ghost').props['backgroundColor']).toBeUndefined();
});

test('a badge on a link is a link, with its label centred inside', async () => {
  await mount();
  const view = badge('link');
  expect(view.viewName).toBe('View');
  expect(view.props).toMatchObject({
    accessibilityRole: 'link',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
    backgroundColor: 'rgb(16, 24, 40)',
  });
  expect((view.children[0] as FakeFabricNode).props).toMatchObject({
    color: 'rgb(249, 250, 251)',
    fontSize: 12,
  });
});

test('a held link badge shows its hover colour, and a span badge has none', async () => {
  await mount();
  const hold = async (id: string, phase: 'Start' | 'End') => {
    const node = badge(id);
    const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, timestamp: 1 };
    const touches = phase === 'Start' ? [point] : [];
    await fireEvent(node, `topTouch${phase}`, { ...point, touches, changedTouches: [point] });
  };
  await hold('link', 'Start');
  await vi.waitFor(() =>
    expect(badge('link').props['backgroundColor']).toBe('rgba(16, 24, 40, 0.8)'),
  );
  await hold('link', 'End');
  await vi.waitFor(() => expect(badge('link').props['backgroundColor']).toBe('rgb(16, 24, 40)'));

  await hold('default', 'Start');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(badge('default').props['backgroundColor']).toBe('rgb(16, 24, 40)');
  await hold('default', 'End');
});
