/**
 * `NativeNavigation`: what each of its five methods asks the router for.
 *
 * The whole service is a translation from "present this as a sheet" into the one thing Angular's
 * router understands, a `navigate()` with state on it. `NativeStackOutlet` reads that state back
 * out and decides what the native stack does, and `router-outlet.test.ts` covers that half - so
 * what is worth pinning here is the encoding, because the two halves only agree by convention. A
 * `stack` this service never sets, or a presentation nested one level too deep, produces a screen
 * that pushes when it should have been a sheet, with nothing in between to complain.
 *
 * `Router` and the outlets' back are stood in for rather than constructed, so each method is seen
 * asking for exactly one thing. `router-back.test.ts` covers going back through the real ones.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { ActivatedRoute, DefaultUrlSerializer, Router, type UrlTree } from '@angular/router';
import { NATIVE_INTENT, NativeNavigation, intentOf } from '../router/src/native-navigation.ts';
import { HardwareBack } from '@ng-native/device';
import { optionalBoolean } from '../router/src/transforms.ts';
import { ownHost } from '../router/src/own-host.ts';
import { tabIconProps } from '../router/src/native-tab.ts';
import { NativeBack } from '../router/src/native-back.ts';
import { servicesWith } from './injected.ts';
import {
  cleanup,
  fireEvent,
  render,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('asking for a screen', () => {
  const serializer = new DefaultUrlSerializer();
  let navigated: { commands: unknown[]; extras: Record<string, unknown> }[] = [];
  let backs = 0;
  let navigation: NativeNavigation;

  beforeEach(() => {
    navigated = [];
    backs = 0;
    navigation = servicesWith(
      [
        [
          Router,
          {
            navigate: (commands: unknown[], extras: Record<string, unknown>) => {
              navigated.push({ commands, extras });
              return Promise.resolve(true);
            },
            // A url string is parsed into commands, as the real router parses it.
            parseUrl: (url: string) => serializer.parse(url),
            // A push asks which tab its url is in, and there is no tab bar here.
            createUrlTree: (commands: unknown[]) => commands,
            serializeUrl: (tree: unknown[] | UrlTree) =>
              Array.isArray(tree) ? tree.join('/') : serializer.serialize(tree),
          },
        ],
        [
          NativeBack,
          {
            back: () => ((backs += 1), true),
            unopenedTabOf: () => null,
            coveredTabAt: () => null,
            inTabBehind: () => false,
          },
        ],
      ],
      () => new NativeNavigation(),
    );
  });

  /** The intent the outlet will read back out of the navigation's state. */
  const intent = (at = 0) =>
    (navigated[at]!.extras['state'] as Record<string, unknown>)[NATIVE_INTENT];

  it('keeps every presentation option beside the kind of presentation asked for', async () => {
    await navigation.present('/sheet', {
      as: 'formSheet',
      presentation: { sheetGrabberVisible: true },
    });
    assert.deepEqual(intent(), {
      stack: 'push',
      presentation: { stackPresentation: 'formSheet', sheetGrabberVisible: true },
    });
  });

  it('turns a string path into the array the router wants', async () => {
    // `push('/detail')` is the shape every call site uses, and `navigate` takes an array. Passing
    // the string straight through navigates to each character.
    await navigation.push('/detail');
    assert.deepEqual(navigated[0]!.commands, ['/', 'detail']);
  });

  it('decodes a string path into segments and matrix parameters', async () => {
    // `navigate` reads a string command as segment text and would escape it again: `%20` would
    // arrive as `%2520` and `;tab=posts` as part of the segment.
    await navigation.push('/user/a%20b;tab=posts');
    assert.deepEqual(navigated[0]!.commands, ['/', 'user', 'a b', { tab: 'posts' }]);
  });

  it("keeps a relative string path's decoded segments literal", async () => {
    // `navigate` splits its first command on `/` and reads `.` and `..` there, so a decoded `a%2Fb`
    // would be two segments and a decoded `%2E%2E` would go up. Only the dots written as dots do.
    const relativeTo = {} as ActivatedRoute;
    await navigation.push('a%2Fb/c', { relativeTo });
    await navigation.push('%2E%2E/c', { relativeTo });
    await navigation.push('../a%2Fb', { relativeTo });
    await navigation.push('../..', { relativeTo });
    assert.deepEqual(
      navigated.map((call) => call.commands),
      [[{ segmentPath: 'a/b' }, 'c'], [{ segmentPath: '..' }, 'c'], ['..', 'a/b'], ['../..']],
    );
  });

  it('keeps the named outlets of a string path', async () => {
    await navigation.push('/a(aux:b;x=1)');
    assert.deepEqual(navigated[0]!.commands, [
      '/',
      { outlets: { primary: ['a'], aux: ['b', { x: '1' }] } },
    ]);
  });

  it('passes an array of commands through as its own array', async () => {
    // Copied rather than forwarded: the router holds onto what it is given, and a caller reusing
    // its array for a second navigation would rewrite the first one's destination.
    const commands = ['/user', 7];
    await navigation.push(commands);
    assert.deepEqual(navigated[0]!.commands, ['/user', 7]);
    assert.notEqual(navigated[0]!.commands, commands);
  });

  it('marks a push as a push', async () => {
    await navigation.push('/detail');
    assert.deepEqual(intent(), { stack: 'push' });
  });

  it('replaces the history entry as well as the screen', async () => {
    /*
     * Both halves matter and they are separate mechanisms. `stack: 'replace'` is what the outlet
     * reads to swap the screen; `replaceUrl` is Angular's, and without it a back from the new
     * screen would return to the one that was replaced - a screen that no longer exists.
     */
    await navigation.replace('/detail');
    assert.equal(navigated[0]!.extras['replaceUrl'], true);
    assert.deepEqual(intent(), { stack: 'replace' });
  });

  it('resets by replacing the url too, since there is nothing to go back to', async () => {
    await navigation.reset('/signed-out');
    assert.equal(navigated[0]!.extras['replaceUrl'], true);
    assert.deepEqual(intent(), { stack: 'reset' });
  });

  it('carries a reset that names a stackAnimation as one that pushes its screen in', async () => {
    // In the intent, not only on the screen the outlet creates: a presented page reads the same
    // presentation, and so does the history entry a screen is restored from.
    await navigation.reset('/signed-out', { presentation: { stackAnimation: 'none' } });
    assert.deepEqual(intent(), {
      stack: 'reset',
      presentation: { stackAnimation: 'none', replaceAnimation: 'push' },
    });
  });

  it('carries a replace that names a stackAnimation as one that pushes its screen in', async () => {
    await navigation.replace('/detail', { presentation: { stackAnimation: 'fade' } });
    assert.deepEqual(intent(), {
      stack: 'replace',
      presentation: { stackAnimation: 'fade', replaceAnimation: 'push' },
    });
  });

  it('leaves a replace that names the default stackAnimation animating as a back', async () => {
    await navigation.replace('/detail', { presentation: { stackAnimation: 'default' } });
    assert.deepEqual(intent(), { stack: 'replace', presentation: { stackAnimation: 'default' } });
  });

  it('leaves a push that names a stackAnimation as it is', async () => {
    await navigation.push('/detail', { presentation: { stackAnimation: 'none' } });
    assert.deepEqual(intent(), { stack: 'push', presentation: { stackAnimation: 'none' } });
  });

  it('presents as a modal unless told otherwise', async () => {
    // A presented screen still *pushes* - it is the `stackPresentation` that makes it a modal
    // rather than a screen in the stack, and `modal` is the default because it is the one that
    // needs no configuring.
    await navigation.present('/filters');
    assert.deepEqual(intent(), { stack: 'push', presentation: { stackPresentation: 'modal' } });
  });

  it('takes the presentation kind from `as`, and merges the rest under it', async () => {
    await navigation.present('/filters', {
      as: 'formSheet',
      presentation: { sheetAllowedDetents: [0.5, 1] },
    });
    assert.deepEqual(intent(), {
      stack: 'push',
      presentation: { stackPresentation: 'formSheet', sheetAllowedDetents: [0.5, 1] },
    });
  });

  it('lets an explicit stackPresentation win over `as`', async () => {
    // `as` is the documented way to say it, so it is spread first and the explicit object second -
    // meaning a caller who writes both gets the longhand. Worth pinning either way round.
    await navigation.present('/filters', {
      as: 'modal',
      presentation: { stackPresentation: 'formSheet' },
    });
    assert.deepEqual(
      (intent() as { presentation: { stackPresentation: string } }).presentation.stackPresentation,
      'formSheet',
    );
  });

  it('does not let `as` reach the router as a navigation extra', async () => {
    // `as` and `presentation` are this service's own vocabulary. Angular's `navigate` ignores what
    // it does not know, so a leak here is invisible until something else reads the extras.
    await navigation.present('/filters', { as: 'formSheet', skipLocationChange: true });
    assert.equal('as' in navigated[0]!.extras, false);
    assert.equal('presentation' in navigated[0]!.extras, false);
    assert.equal(navigated[0]!.extras['skipLocationChange'], true);
  });

  it("keeps a caller's own state beside the intent rather than instead of it", async () => {
    /*
     * The intent travels in `state`, which is also where an app puts its own. Overwriting it would
     * make every navigation with state push instead of present, and dropping the intent key would
     * do the reverse - so both have to survive together.
     */
    await navigation.push('/detail', { state: { from: 'search' } });
    const state = navigated[0]!.extras['state'] as Record<string, unknown>;
    assert.equal(state['from'], 'search');
    assert.deepEqual(state[NATIVE_INTENT], { stack: 'push' });
  });

  it('forwards the ordinary navigation extras untouched', async () => {
    await navigation.push('/detail', { queryParams: { q: 'x' }, fragment: 'top' });
    assert.deepEqual(navigated[0]!.extras['queryParams'], { q: 'x' });
    assert.equal(navigated[0]!.extras['fragment'], 'top');
  });

  it('goes back through the outlets in front, as the Android back button does', async () => {
    // Not `Router.navigate`, which would push a new entry that happens to look like the old
    // screen, and not one entry back through history, which after a trip to another tab is that
    // tab rather than the screen below.
    navigation.back();
    assert.equal(backs, 1);
    assert.equal(navigated.length, 0);
  });
});

describe('nativeRouterLink', () => {
  let mod: Record<string, unknown>;
  let navigated: { method: string; commands: unknown; extras: Record<string, unknown> }[];
  let fabric: FakeFabric;

  /** The pressable around a label: the label is a raw text inside a text inside it. */
  const labelled = (text: string) =>
    flatten(fabric.committed).find((node) =>
      node.children.some((child) => child.children.some((leaf) => leaf.props['text'] === text)),
    )!;

  /** The route the links sit on, which a relative link resolves against. */
  const here = { snapshot: {} } as unknown as ActivatedRoute;

  /** A stand-in that records which of its methods a link asked for, and with what. */
  const recorded = (method: string) => (commands: unknown, extras: Record<string, unknown>) => {
    navigated.push({ method, commands, extras });
    return Promise.resolve(true);
  };

  before(async () => {
    mod = await compileFixture('fixtures/router-link.ts');
  });

  beforeEach(async () => {
    navigated = [];
    const app = await render(mod['Links'] as Type<unknown>, {
      providers: [
        {
          provide: NativeNavigation,
          useValue: { push: recorded('push'), replace: recorded('replace') },
        },
        { provide: ActivatedRoute, useValue: here },
      ],
    });
    fabric = app.fabric;
  });

  afterEach(() => cleanup());

  it('replaces the screen as well as the history entry when told to replace', async () => {
    // `replaceUrl` alone swaps the history entry and pushes a screen anyway: the one it meant to
    // replace stays mounted underneath, and a swipe back lands on it.
    await fireEvent.press(labelled('replace'));
    assert.equal(navigated[0]!.method, 'replace');
    assert.equal(navigated[0]!.commands, '/replaced');
  });

  it('reads a bare replace attribute as replace, as a boolean attribute is read', async () => {
    await fireEvent.press(labelled('bare replace'));
    assert.equal(navigated[0]!.method, 'replace');
  });

  it('resolves a relative link against the route it is on, keeping the extras it was given', async () => {
    await fireEvent.press(labelled('relative'));
    assert.equal(navigated[0]!.commands, 'detail');
    assert.equal(navigated[0]!.extras['relativeTo'], here);
    assert.equal(navigated[0]!.method, 'replace', 'its own extras win over the default');
  });

  it('pushes on a plain press, the url as written and resolved against no route', async () => {
    await fireEvent.press(labelled('push'));
    assert.equal(navigated[0]!.method, 'push');
    assert.equal(navigated[0]!.commands, '/pushed');
    assert.equal(navigated[0]!.extras['relativeTo'], null);
  });
});

describe('the helpers the router is built from', () => {
  it('reads an intent only when the navigation state carries one as an object', () => {
    assert.equal(intentOf({ [NATIVE_INTENT]: 'push' }), null);
    assert.deepEqual(intentOf({ [NATIVE_INTENT]: { stack: 'push' } }), { stack: 'push' });
    assert.equal(intentOf(null), null);
  });

  it('leaves an unset boolean input unset, so a default can still apply', () => {
    assert.equal(optionalBoolean(undefined), undefined);
    assert.equal(optionalBoolean(''), true);
  });

  it("claims a host and takes the directive's inputs off it, so they are not sent as props", () => {
    const node = { props: { title: 'Inbox', testID: 'bar' } } as { props: Record<string, unknown> };
    ownHost(node, { ɵcmp: { inputs: { title: 'title' } } });
    assert.deepEqual(node.props, { testID: 'bar' });
    assert.equal((node as { claimed?: true }).claimed, true);
  });

  it("gives a tab's selected icon the selected icon's own image", () => {
    const props = tabIconProps({ imageIconResource: 'plain' }, { imageIconResource: 'bold' });
    assert.equal(props.selectedImageIconResource, 'bold');
  });

  it('stops asking a back handler once it has let go', () => {
    let asked = 0;
    const back = servicesWith([[HardwareBack, { handle: () => () => {} }]], () => new NativeBack());
    const stop = back.handle(() => (asked++, true));
    stop();
    assert.equal(back.back(), false);
    assert.equal(asked, 0);
  });
});
