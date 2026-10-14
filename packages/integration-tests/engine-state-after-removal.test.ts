/**
 * `:focus` and `:active` on a node that leaves the tree without the event that would clear them:
 * native sends no blur for a field removed with the keyboard up, and no touch end for a view
 * removed under the finger. Put back, or left behind as an ancestor, it is not styled as focused
 * or pressed any more.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
const sheet = (css: string) => compileCss(css, 'app.css') as StyleSheet;
const find = (nodes: readonly FakeFabricNode[], id: string): FakeFabricNode | undefined => {
  for (const n of nodes) {
    const f = n.props['nativeID'] === id ? n : find(n.children, id);
    if (f) return f;
  }
  return undefined;
};
function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet(css) });
  const make = (name: string, id: string, parent = engine.root) => {
    const n = engine.createElement(name);
    engine.setProp(n, 'nativeID', id);
    engine.setClasses(n, id);
    engine.appendChild(parent, n);
    return n;
  };
  return { fabric, engine, make, id: (id: string) => find(fabric.committed, id) };
}

it('is not focused when put back after leaving with the focus', () => {
  const s = scene('.field:focus { opacity: 0.5 }');
  const wrap = s.make('view', 'wrap');
  const field = s.make('text-input', 'field', wrap);
  s.engine.commit();
  s.fabric.emit(s.id('field')!, 'topFocus', {});
  assert.equal(s.id('field')!.props['opacity'], 0.5);
  s.engine.removeChild(s.engine.root, wrap);
  s.engine.commit();
  s.engine.appendChild(s.engine.root, wrap);
  s.engine.commit();
  assert.equal(s.engine.focused, null);
  assert.equal(s.id('field')!.props['opacity'], undefined, 'no longer :focus');
});

it('is not focused when put back after being destroyed with the focus', () => {
  const s = scene('.field:focus { opacity: 0.5 }');
  const wrap = s.make('view', 'wrap');
  const field = s.make('text-input', 'field', wrap);
  s.engine.commit();
  s.fabric.emit(s.id('field')!, 'topFocus', {});
  s.engine.removeChild(wrap, field);
  s.engine.destroyNode(field);
  s.engine.commit();
  s.engine.appendChild(wrap, field);
  s.engine.commit();
  assert.equal(s.id('field')!.props['opacity'], undefined, 'no longer :focus');
});

it('leaves no ancestor pressed when the pressed node is removed mid-press', () => {
  const s = scene('.card:active { opacity: 0.5 } .btn:active { opacity: 0.2 }');
  const card = s.make('view', 'card');
  const btn = s.make('view', 'btn', card);
  s.engine.setResponder(btn, { onStartShouldSetResponder: () => true });
  s.engine.commit();
  s.fabric.emit(s.id('btn')!, 'topTouchStart', { touches: [{}], changedTouches: [{}] });
  assert.equal(s.id('card')!.props['opacity'], 0.5);
  const handle = s.id('btn')!;
  s.engine.removeChild(card, btn);
  s.engine.commit();
  s.fabric.emit(handle, 'topTouchEnd', { touches: [], changedTouches: [{}] });
  s.engine.commit();
  assert.equal(s.id('card')!.props['opacity'] ?? undefined, undefined, 'card no longer pressed');
});

it('keeps a press going while something else leaves the tree', () => {
  const s = scene('.card:active { opacity: 0.5 }');
  const card = s.make('view', 'card');
  const btn = s.make('view', 'btn', card);
  const other = s.make('view', 'other');
  s.engine.setResponder(btn, { onStartShouldSetResponder: () => true });
  s.engine.commit();
  s.fabric.emit(s.id('btn')!, 'topTouchStart', { touches: [{}], changedTouches: [{}] });
  s.engine.removeChild(s.engine.root, other);
  s.engine.commit();
  assert.equal(s.id('card')!.props['opacity'], 0.5, 'still pressed');
  s.fabric.emit(s.id('btn')!, 'topTouchEnd', { touches: [], changedTouches: [{}] });
  s.engine.commit();
  assert.equal(s.id('card')!.props['opacity'] ?? undefined, undefined, 'and released');
});

it('keeps the focus while another node is destroyed', () => {
  const s = scene('.field:focus { opacity: 0.5 }');
  const field = s.make('text-input', 'field');
  const other = s.make('view', 'other');
  s.engine.commit();
  s.fabric.emit(s.id('field')!, 'topFocus', {});
  s.engine.destroyNode(other);
  s.engine.commit();
  assert.equal(s.engine.focused, field);
  assert.equal(s.id('field')!.props['opacity'], 0.5);
});

it('shows a field again that a :focus rule hid, once hiding it has taken the focus away', () => {
  // `display: none` takes the focus, as in a browser, and with it the `:focus` that hid the field.
  const s = scene('.field:focus { display: none }');
  s.make('text-input', 'field');
  s.engine.commit();
  s.fabric.emit(s.id('field')!, 'topFocus', {});
  s.engine.commit();
  assert.equal(s.engine.focused, null, 'no longer focused');
  assert.ok(s.id('field'), 'and shown again');
});
