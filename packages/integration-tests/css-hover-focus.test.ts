/**
 * `:hover`, `:focus-within` and `:focus-visible`, which a desktop host makes worth answering.
 *
 * `:hover` follows the pointer events native sends a view that opts in with `onPointerEnter` and
 * `onPointerLeave`. Only a view a `:hover` rule could match opts in, so an app with no such rule
 * commits no extra prop at all. A finger is no hover: with pointer events on, a touch enters what
 * it lands on and leaves as it lifts.
 *
 * `:focus-within` is true of the focused element and every ancestor of it. `:focus-visible` is
 * true of the focused element when the host said the focus came from the keyboard, with
 * `focusVisible: true` on the `topFocus` event.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const sheet = (css: string) => compileCss(css, 'app.css') as StyleSheet;

function find(nodes: readonly FakeFabricNode[], id: string): FakeFabricNode | undefined {
  for (const n of nodes) {
    const found = n.props['nativeID'] === id ? n : find(n.children, id);
    if (found) return found;
  }
  return undefined;
}

function every(nodes: readonly FakeFabricNode[], out: FakeFabricNode[] = []): FakeFabricNode[] {
  for (const n of nodes) {
    out.push(n);
    every(n.children, out);
  }
  return out;
}

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet(css) });
  const make = (name: string, id: string, parent: EngineNode = engine.root) => {
    const n = engine.createElement(name);
    engine.setProp(n, 'nativeID', id);
    engine.setClasses(n, id);
    engine.appendChild(parent, n);
    return n;
  };
  const id = (name: string) => find(fabric.committed, name)!;
  const pointer = (name: string, type: 'Enter' | 'Leave', pointerType = 'mouse') => {
    fabric.emit(id(name), `topPointer${type}`, { pointerType });
    engine.commit();
  };
  return { fabric, engine, make, id, pointer };
}

describe(':hover', () => {
  it('compiles at the specificity of a class, as :active does', () => {
    for (const state of ['hover', 'focus-visible', 'focus-within']) {
      assert.equal(
        sheet(`view:${state} { color: red }`).rules[0]!.specificity,
        sheet('view.x { color: red }').rules[0]!.specificity,
        state,
      );
    }
  });

  it('follows a mouse in and out', () => {
    const s = scene('.btn:hover { opacity: 0.5 }');
    s.make('view', 'btn');
    s.engine.commit();
    assert.equal(s.id('btn').props['opacity'], undefined);
    s.pointer('btn', 'Enter');
    assert.equal(s.id('btn').props['opacity'], 0.5);
    s.pointer('btn', 'Leave');
    assert.equal(s.id('btn').props['opacity'], null);
  });

  it('never matches a finger', () => {
    const s = scene('.btn:hover { opacity: 0.5 }');
    s.make('view', 'btn');
    s.engine.commit();
    s.pointer('btn', 'Enter', 'touch');
    assert.equal(s.id('btn').props['opacity'], undefined);
  });

  it('restyles what a hovered ancestor styles beneath it', () => {
    const s = scene('.card:hover .title { opacity: 0.5 }');
    const card = s.make('view', 'card');
    s.make('view', 'title', card);
    s.engine.commit();
    s.pointer('card', 'Enter');
    assert.equal(s.id('title').props['opacity'], 0.5);
    s.pointer('card', 'Leave');
    assert.equal(s.id('title').props['opacity'], null);
  });

  it('opts only the views a :hover rule could match into pointer events', () => {
    const s = scene('.card:hover .title { opacity: 0.5 } .btn:hover { opacity: 0.2 }');
    const card = s.make('view', 'card');
    s.make('view', 'title', card);
    s.make('view', 'btn');
    s.make('view', 'other');
    s.engine.commit();
    assert.equal(s.id('card').props['onPointerEnter'], true);
    assert.equal(s.id('card').props['onPointerLeave'], true);
    assert.equal(s.id('btn').props['onPointerEnter'], true);
    assert.equal(s.id('title').props['onPointerEnter'], undefined);
    assert.equal(s.id('other').props['onPointerEnter'], undefined);
  });

  it('commits no pointer opt-in at all in an app with no :hover rule', () => {
    const s = scene('.btn:active { opacity: 0.5 } .card { opacity: 0.9 }');
    const card = s.make('view', 'card');
    s.make('view', 'btn', card);
    s.engine.commit();
    for (const node of every(s.fabric.committed)) {
      assert.equal('onPointerEnter' in node.props, false);
      assert.equal('onPointerLeave' in node.props, false);
    }
  });

  it('opts a view in when it gains the class a rule hovers, and out when it loses it', () => {
    const s = scene('.btn:hover { opacity: 0.5 }');
    const node = s.make('view', 'x');
    s.engine.commit();
    assert.equal(s.id('x').props['onPointerEnter'], undefined);
    s.engine.setClasses(node, 'x btn');
    s.engine.commit();
    assert.equal(s.id('x').props['onPointerEnter'], true);
    s.engine.setClasses(node, 'x');
    s.engine.commit();
    assert.equal(s.id('x').props['onPointerEnter'], null);
  });

  it('forgets the hover of a view that lost the class, as native stops telling it', () => {
    const s = scene('.btn:hover { opacity: 0.5 }');
    const node = s.make('view', 'btn');
    s.engine.commit();
    s.pointer('btn', 'Enter');
    s.engine.setClasses(node, 'x');
    s.engine.commit();
    s.engine.setClasses(node, 'btn');
    s.engine.commit();
    assert.equal(s.id('btn').props['opacity'] ?? undefined, undefined);
  });

  it('opts views out and drops the hover when the last :hover rule goes away', () => {
    const s = scene('.base { opacity: 1 }');
    const hover = sheet('.btn:hover { opacity: 0.5 }');
    s.engine.addGlobalSheet(hover);
    s.make('view', 'btn');
    s.engine.commit();
    s.pointer('btn', 'Enter');
    assert.equal(s.id('btn').props['opacity'], 0.5);
    s.engine.removeGlobalSheet(hover);
    s.engine.commit();
    assert.equal(s.id('btn').props['onPointerEnter'], null);
    assert.equal(s.id('btn').props['opacity'], null);
    // The same rule back is not hovered by the pointer that entered before it went.
    s.engine.addGlobalSheet(hover);
    s.engine.commit();
    assert.equal(s.id('btn').props['onPointerEnter'], true);
    assert.equal(s.id('btn').props['opacity'] ?? undefined, undefined);
  });

  it('opts views in when a sheet with a :hover rule arrives', () => {
    const s = scene('.base { opacity: 1 }');
    s.make('view', 'btn');
    s.engine.commit();
    s.engine.addGlobalSheet(sheet('.btn:hover { opacity: 0.5 }'));
    s.engine.commit();
    assert.equal(s.id('btn').props['onPointerEnter'], true);
  });

  it('keeps the opt-in a listener asked for when the rule goes away', () => {
    const s = scene('.base { opacity: 1 }');
    const hover = sheet('.btn:hover { opacity: 0.5 }');
    s.engine.addGlobalSheet(hover);
    const btn = s.make('view', 'btn');
    s.engine.setEventListener(btn, 'topPointerEnter', () => {});
    s.engine.commit();
    s.engine.removeGlobalSheet(hover);
    s.engine.commit();
    assert.equal(s.id('btn').props['onPointerEnter'], true);
  });

  it('is not hovered when put back after leaving the tree hovered', () => {
    const s = scene('.btn:hover { opacity: 0.5 }');
    const wrap = s.make('view', 'wrap');
    const btn = s.make('view', 'btn', wrap);
    s.engine.commit();
    s.pointer('btn', 'Enter');
    s.engine.removeChild(wrap, btn);
    s.engine.commit();
    s.engine.appendChild(wrap, btn);
    s.engine.commit();
    assert.equal(s.id('btn').props['opacity'] ?? undefined, undefined);
  });

  it('is not hovered when put back after being destroyed hovered', () => {
    const s = scene('.btn:hover { opacity: 0.5 }');
    const wrap = s.make('view', 'wrap');
    const btn = s.make('view', 'btn', wrap);
    s.engine.commit();
    s.pointer('btn', 'Enter');
    s.engine.removeChild(wrap, btn);
    s.engine.destroyNode(btn);
    s.engine.commit();
    s.engine.appendChild(wrap, btn);
    s.engine.commit();
    assert.equal(s.id('btn').props['opacity'] ?? undefined, undefined);
  });
});

describe('pointer enter and leave', () => {
  // Issue 1431: native sends an enter to each view the pointer enters, the W3C way, and bubbling
  // the child's to its parent ran the parent's handler a second time.
  it('runs a handler once for one pointer entering a view and the view inside it', () => {
    const s = scene('.base { opacity: 1 }');
    const outer = s.make('view', 'outer');
    s.make('view', 'inner', outer);
    let enters = 0;
    let leaves = 0;
    s.engine.setEventListener(outer, 'topPointerEnter', () => enters++);
    s.engine.setEventListener(outer, 'topPointerLeave', () => leaves++);
    s.engine.commit();
    s.fabric.emit(s.id('outer'), 'topPointerEnter', { pointerType: 'mouse' });
    s.fabric.emit(s.id('inner'), 'topPointerEnter', { pointerType: 'mouse' });
    s.fabric.emit(s.id('inner'), 'topPointerLeave', { pointerType: 'mouse' });
    s.fabric.emit(s.id('outer'), 'topPointerLeave', { pointerType: 'mouse' });
    assert.equal(enters, 1);
    assert.equal(leaves, 1);
  });
});

describe(':focus-within', () => {
  it('applies to every ancestor of the focused element and clears on blur', () => {
    const s = scene('.form:focus-within { opacity: 0.5 } .page:focus-within { opacity: 0.7 }');
    const page = s.make('view', 'page');
    const form = s.make('view', 'form', page);
    s.make('text-input', 'field', form);
    s.engine.commit();
    s.fabric.emit(s.id('field'), 'topFocus', {});
    s.engine.commit();
    assert.equal(s.id('form').props['opacity'], 0.5);
    assert.equal(s.id('page').props['opacity'], 0.7);
    s.fabric.emit(s.id('field'), 'topBlur', {});
    s.engine.commit();
    assert.equal(s.id('form').props['opacity'], null);
    assert.equal(s.id('page').props['opacity'], null);
  });

  it('moves with the focus to another branch', () => {
    const s = scene('.form:focus-within { opacity: 0.5 }');
    const form = s.make('view', 'form');
    s.make('text-input', 'a', form);
    s.make('text-input', 'b');
    s.engine.commit();
    s.fabric.emit(s.id('a'), 'topFocus', {});
    s.engine.commit();
    assert.equal(s.id('form').props['opacity'], 0.5);
    s.fabric.emit(s.id('b'), 'topFocus', {});
    s.engine.commit();
    assert.equal(s.id('form').props['opacity'], null);
  });

  it('leaves no ancestor focused-within when the focused field leaves the tree', () => {
    const s = scene('.form:focus-within { opacity: 0.5 }');
    const form = s.make('view', 'form');
    const field = s.make('text-input', 'field', form);
    s.engine.commit();
    s.fabric.emit(s.id('field'), 'topFocus', {});
    s.engine.commit();
    s.engine.removeChild(form, field);
    s.engine.destroyNode(field);
    s.engine.commit();
    assert.equal(s.id('form').props['opacity'], null);
  });

  it('matches the focused element itself', () => {
    const s = scene('.field:focus-within { opacity: 0.5 }');
    s.make('text-input', 'field');
    s.engine.commit();
    s.fabric.emit(s.id('field'), 'topFocus', {});
    s.engine.commit();
    assert.equal(s.id('field').props['opacity'], 0.5);
  });
});

describe(':focus-visible', () => {
  it('matches focus the host says came from the keyboard, and not a click', () => {
    const s = scene('.field:focus-visible { opacity: 0.5 } .field:focus { border-width: 1px }');
    s.make('text-input', 'field');
    s.make('text-input', 'other');
    s.engine.commit();
    s.fabric.emit(s.id('field'), 'topFocus', {});
    s.engine.commit();
    assert.equal(s.id('field').props['opacity'], undefined, 'a click draws no ring');
    s.fabric.emit(s.id('other'), 'topFocus', {});
    s.fabric.emit(s.id('field'), 'topFocus', { focusVisible: true });
    s.engine.commit();
    assert.equal(s.id('field').props['opacity'], 0.5, 'Tab does');
    s.fabric.emit(s.id('field'), 'topBlur', {});
    s.engine.commit();
    assert.equal(s.id('field').props['opacity'], null);
  });
});
