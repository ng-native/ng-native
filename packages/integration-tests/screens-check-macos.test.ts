/**
 * The macOS mode of the screens-check skill (`.claude/skills/screens-check/macos.mjs`): the parts
 * that decide which window to capture, what to call a screenshot and how to tell a screen has
 * stopped changing, with no host launched.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

interface WindowInfo {
  id: number;
  pid: number;
  layer: number;
  onscreen: boolean;
  width: number;
  height: number;
}

const script = new URL('../../.claude/skills/screens-check/macos.mjs', import.meta.url);
const { deepLink, hostWindow, openArguments, screenshotName, settled } = (await import(
  script.href
)) as {
  deepLink(scheme: string, route: string): string;
  hostWindow(windows: WindowInfo[], pid: number): WindowInfo | undefined;
  openArguments(target: { app: string }, link: string): string[];
  screenshotName(route: string, labels: string[]): string;
  settled(previous: string | undefined, current: string): boolean;
};

const window = (over: Partial<WindowInfo>): WindowInfo => ({
  id: 1,
  pid: 100,
  layer: 0,
  onscreen: true,
  width: 800,
  height: 600,
  ...over,
});

describe('which window is the host window', () => {
  it("is the largest on-screen normal window of the host's process", () => {
    const windows = [
      window({ id: 1, pid: 200, width: 2000, height: 1000 }),
      window({ id: 2, pid: 100, width: 300, height: 200 }),
      window({ id: 3, pid: 100, width: 900, height: 700 }),
      window({ id: 4, pid: 100, layer: 25, width: 3000, height: 40 }),
      window({ id: 5, pid: 100, onscreen: false, width: 4000, height: 4000 }),
    ];
    assert.equal(hostWindow(windows, 100)?.id, 3);
  });

  it('ignores a sliver, such as a shadow or a hidden title bar, and answers none without a window', () => {
    assert.equal(hostWindow([window({ width: 30, height: 20 })], 100), undefined);
    assert.equal(hostWindow([], 100), undefined);
  });
});

describe('a screen that has stopped changing', () => {
  it('is two captures a second apart that are the same, and not before', () => {
    assert.equal(settled(undefined, 'a'), false);
    assert.equal(settled('a', 'b'), false);
    assert.equal(settled('b', 'b'), true);
  });
});

describe('opening a route', () => {
  it('builds the link from the scheme and the route, with or without the leading slash', () => {
    assert.equal(deepLink('canary', '/overlays'), 'canary://overlays');
    assert.equal(deepLink('canary', 'overlays/toast'), 'canary://overlays/toast');
    assert.equal(deepLink('canary', '/'), 'canary://');
  });

  it('hands a packaged app the link through LaunchServices, a new instance each time', () => {
    assert.deepEqual(openArguments({ app: '/x/Canary.app' }, 'canary://a'), [
      '-n',
      '-a',
      '/x/Canary.app',
      'canary://a',
    ]);
  });
});

describe('screenshot names', () => {
  it('make one file per route and tapped label, as the iOS mode does', () => {
    assert.equal(screenshotName('/overlays', []), 'overlays.png');
    assert.equal(
      screenshotName('/overlays/toast', ['Show a toast']),
      'overlays-toast-Show-a-toast.png',
    );
    assert.equal(screenshotName('/', []), 'home.png');
  });
});
