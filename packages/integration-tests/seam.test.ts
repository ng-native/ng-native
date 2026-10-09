/**
 * The whole seam, in Node, against a fake Fabric: a zoneless component with a signal, control
 * flow and a press listener mounts, re-renders and dispatches through the real renderer, with at
 * most one commit per change-detection pass. No simulator.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount, type MountResult } from '@ng-native/platform';
import { createFakeFabric, type FakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const ROOT_TAG = 1;

/** Zoneless change detection lands on a microtask; let it settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the seam, end to end', () => {
  let fabric: FakeFabric;
  let app: MountResult;
  const processed: string[] = [];

  before(async () => {
    const mod = await compileFixture('fixtures/counter.ts');
    fabric = createFakeFabric();
    app = mount(ROOT_TAG, mod['Counter'] as Type<unknown>, fabric, {
      processColor: (value) => {
        if (typeof value === 'string') processed.push(value);
        return value === '#ff0000' ? 0xffff0000 : value;
      },
    });
    await settle();
  });

  after(() => app.applicationRef.destroy());

  it('commits a native tree on mount, with comment anchors elided', () => {
    assert.equal(
      fabric.render(),
      ['View', '  View', '    View', '      Paragraph', '        RawText "tap"'].join('\n'),
    );
  });

  it('maps element names to Fabric view names', () => {
    // `pressable` is a JS composite in RN, not a native view: it commits as an View.
    assert.equal(fabric.committed[0]?.children[0]?.viewName, 'View');
    assert.equal(fabric.committed[0]?.children[0]?.children.at(-1)?.viewName, 'View');
  });

  it('flattens style onto props rather than nesting it', () => {
    const root = fabric.committed[0]!.children[0]!;
    assert.equal(root.props['padding'], 8, 'style keys land at the top level');
    assert.equal(root.props['style'], undefined, 'no nested style object reaches Fabric');
  });

  it('processes colour props through the injected processColor', () => {
    assert.equal(processed.includes('#ff0000'), true);
  });

  it('commits exactly once per change-detection pass', async () => {
    const before = app.engine.stats.commits;
    const completeRootsBefore = fabric.calls.completeRoot;

    fabric.emit(fabric.committed[0]!.children[0]!.children.at(-1)!, 'topTouchEnd');
    await settle();

    assert.equal(app.engine.stats.commits - before, 1, 'one renderer flush');
    assert.equal(fabric.calls.completeRoot - completeRootsBefore, 1, 'one completeRoot');
  });

  it('renders @if and @for after the event', () => {
    assert.equal(
      fabric.render(),
      [
        'View',
        '  View',
        '    Paragraph',
        '      RawText "count is 1"',
        '    Paragraph',
        '      RawText "item 0"',
        '    View',
        '      Paragraph',
        '        RawText "tap"',
      ].join('\n'),
    );
  });

  it('grows the @for list on repeat events', async () => {
    fabric.emit(fabric.committed[0]!.children[0]!.children.at(-1)!, 'topTouchEnd');
    await settle();

    assert.equal(
      fabric.render(),
      [
        'View',
        '  View',
        '    Paragraph',
        '      RawText "count is 2"',
        '    Paragraph',
        '      RawText "item 0"',
        '    Paragraph',
        '      RawText "item 1"',
        '    View',
        '      Paragraph',
        '        RawText "tap"',
      ].join('\n'),
    );
  });

  it('allocates even, unique reactTags', () => {
    // Odd tags collide with surface root tags (1, 11, 21, ...) and crash natively inside
    // UIKit with no JS error. React allocates the same way: start at 2, step by 2.
    const tags: number[] = [];
    const collect = (nodes: { reactTag: number; children: typeof nodes }[]): void => {
      for (const n of nodes) {
        tags.push(n.reactTag);
        collect(n.children);
      }
    };
    collect(fabric.committed as never);

    assert.ok(tags.length > 0, 'nodes were created');
    assert.deepEqual(
      tags.filter((t) => t % 2 !== 0),
      [],
      'every reactTag is even',
    );
    assert.equal(new Set(tags).size, tags.length, 'no duplicate reactTags');
  });

  it('does not commit when nothing changed', async () => {
    const before = app.engine.stats.commits;
    app.applicationRef.tick();
    await settle();
    assert.equal(app.engine.stats.commits, before);
  });
});
