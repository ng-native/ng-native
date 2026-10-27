/**
 * A tab kept from an earlier visit, behind a guard: native is told not to select it on a tap, so
 * the page it holds is not shown before the guard has said yes. The tap comes as a prevented
 * selection, which the router follows, and the tab is selected once the navigation arrives.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { inject, type Type } from '@angular/core';
import { Router, type Route, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/tab-stacks.ts');
});

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await settle();
}

/** The fixture's routes, with the Library tab's first screen let in while `allowed` says so. */
function guarded(allowed: () => boolean): Routes {
  const [bar, ...rest] = mod['routes'] as Routes;
  const children = bar!.children!.map((child): Route => {
    if (child.path !== 'library') return child;
    return {
      ...child,
      children: child.children!.map((page) =>
        page.path === ''
          ? { ...page, canActivate: [() => allowed() || inject(Router).parseUrl('/home')] }
          : page,
      ),
    };
  });
  return [{ ...bar!, children }, ...rest];
}

it('selects a kept tab behind a guard only once the guard lets it in', async () => {
  let allowed = true;
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(guarded(() => allowed))],
  });
  await idle();
  const router = app.componentRef.injector.get(Router);
  const nodes = () => flatten(app.fabric.committed);
  const host = () => nodes().find((node) => node.viewName === 'RNSTabsHostIOS')!;
  const tab = (key: string) =>
    nodes().find(
      (node) => node.viewName === 'RNSTabsScreenIOS' && node.props['screenKey'] === key,
    )!;
  const selected = () =>
    (host().props['navStateRequest'] as { selectedScreenKey: string }).selectedScreenKey;
  let provenance = 0;
  const tapPrevented = async (key: string) => {
    await fireEvent(host(), 'tabSelectionPrevented', {
      selectedScreenKey: selected(),
      preventedScreenKey: key,
      provenance: ++provenance,
    });
    await idle();
  };

  // Never opened: nothing kept to show, so native selects it at once.
  assert.notEqual(tab('library').props['preventNativeSelection'], true);
  await router.navigateByUrl('/library');
  await idle();
  // In front, a tap on it is native's to take, as a tap back to its first screen.
  assert.notEqual(tab('library').props['preventNativeSelection'], true);
  await router.navigateByUrl('/home');
  await idle();
  assert.equal(tab('library').props['preventNativeSelection'], true, 'kept, and guarded');
  assert.notEqual(tab('home').props['preventNativeSelection'], true, 'no guard on the way');

  allowed = false;
  await tapPrevented('library');
  assert.equal(router.url, '/home');
  assert.equal(selected(), 'home', 'the bar stays where the guard left it');

  allowed = true;
  await tapPrevented('library');
  assert.equal(router.url, '/library');
  assert.equal(selected(), 'library');
});
