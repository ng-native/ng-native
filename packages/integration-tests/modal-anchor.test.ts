/**
 * `<modal [anchor]>`: a modal pointed at an element shows as a popover where the OS has them.
 *
 * The host contract: `ModalHostView` takes an `anchor` prop, the react tag of the anchor's
 * committed view. The desktop host shows the modal as an NSPopover at that view; iOS and Android
 * ignore it and present as they would without it. The desktop host reads the anchor as it
 * presents, so on macOS a modal is not committed before its anchor's tag is known. `null` takes the
 * anchor away, so the next presentation is a sheet again.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { OS } from '@ng-native/device';
import { mount } from '@ng-native/platform';
import {
  cleanup,
  createFakeFabric,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = {
  anchored: { set(value: boolean): void };
  useButton: { set(value: boolean): void };
  other: { set(value: unknown): void };
};

const macos = [{ provide: OS, useValue: 'macos' }];

/** A fake Fabric that records, after each commit, the `pop` modal's props, or null without it. */
function recording() {
  const fabric = createFakeFabric();
  const complete = fabric.completeRoot.bind(fabric);
  const commits: (Record<string, unknown> | null)[] = [];
  const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
    for (const node of nodes) {
      if (node.props['testID'] === 'pop') return node;
      const hit = find(node.children);
      if (hit) return hit;
    }
    return undefined;
  };
  fabric.completeRoot = (tag, set) => {
    complete(tag, set);
    commits.push(find(fabric.committed)?.props ?? null);
  };
  return { fabric, commits };
}
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/modal-anchor.ts');
  Fixture = mod['ModalAnchorFixture'] as Type<Fixture>;
});

afterEach(cleanup);

describe('a modal with an anchor', () => {
  it('commits the anchor view tag, and nothing on a modal without one', async () => {
    const app = await render(Fixture);
    await app.detectChanges();
    const pop = screen.getByTestId('pop');
    assert.equal(pop.viewName, 'ModalHostView');
    assert.equal(pop.props['anchor'], screen.getByTestId('target').reactTag);
    assert.equal('anchor' in screen.getByTestId('sheet').props, false);
  });

  it('is first committed with its anchor on macOS, when it shows from the start', async () => {
    const { fabric, commits } = recording();
    const app = mount(1, Fixture, fabric, { providers: macos });
    try {
      await settle();
      const shown = commits.filter((props) => props !== null);
      assert.ok(shown.length > 0, 'the modal is committed');
      assert.equal(typeof shown[0]!['anchor'], 'number', 'its first commit points it at the anchor');
    } finally {
      app.applicationRef.destroy();
    }
  });

  it('stays shown on an OS that ignores the anchor, while a new one has still to commit', async () => {
    // iOS: a presented modal committed with visible false is dismissed, and an anchor it does not
    // read is nothing to wait for.
    const { fabric, commits } = recording();
    const app = mount(1, Fixture, fabric);
    try {
      await settle();
      const engine = app.engine;
      const late = engine.createElement('view');
      engine.appendChild(engine.root, late);
      commits.length = 0;
      (app.componentRef.instance as Fixture).other.set(late);
      await settle();
      assert.ok(commits.length > 0, 'the change was committed');
      for (const props of commits) assert.equal(props?.['visible'], true);
    } finally {
      app.applicationRef.destroy();
    }
  });

  it('takes a component as its anchor, by the view it renders', async () => {
    const app = await render(Fixture);
    app.instance.useButton.set(true);
    await app.detectChanges();
    assert.equal(screen.getByTestId('pop').props['anchor'], screen.getByTestId('button').reactTag);
  });

  it('commits null as the anchor goes, so native drops the one it had', async () => {
    const app = await render(Fixture);
    await app.detectChanges();
    app.instance.anchored.set(false);
    await app.detectChanges();
    assert.equal(screen.getByTestId('pop').props['anchor'], null);
  });
});
