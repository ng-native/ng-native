/**
 * `:dir(ltr)` and `:dir(rtl)`: the direction the app is laid out in.
 *
 * A browser answers `:dir()` from the document's direction. Here that is the app's, which the
 * device settles as it starts, so the rule holds or not for every element at once, as a media
 * query does. Tailwind writes `ltr:` and `rtl:` as `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)`:
 * the first alternative is the app's direction and the other two an element that says its own.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const BASE = { width: 400, height: 800, colorScheme: 'light' as const };

/** The committed props of one view with class `a`, inside a view with `outer` props. */
function props(css: string, direction?: 'ltr' | 'rtl', outer: Record<string, unknown> = {}) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: sheet as never,
    conditions: { ...BASE, ...(direction && { direction }) },
  });
  const parent = engine.createElement('view');
  for (const [key, value] of Object.entries(outer)) engine.setProp(parent, key, value);
  engine.appendChild(engine.root, parent);
  const node = engine.createElement('view');
  engine.setClasses(node, 'a');
  engine.appendChild(parent, node);
  engine.commit();
  assert.deepEqual(reports, []);
  return fabric.committed[0]!.children[0]!.props;
}

const RTL = '.a:dir(rtl) { opacity: 0.5 }';
const TAILWIND_RTL = '.a:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { opacity: 0.5 }';
const TAILWIND_LTR = '.a:where(:dir(ltr), [dir="ltr"], [dir="ltr"] *) { opacity: 0.5 }';

describe(':dir()', () => {
  it('holds in an app laid out in that direction, and not in one laid out the other way', () => {
    assert.equal(props(RTL, 'rtl')['opacity'], 0.5);
    assert.equal(props(RTL, 'ltr')['opacity'], undefined);
    assert.equal(props('.a:dir(ltr) { opacity: 0.5 }', 'ltr')['opacity'], 0.5);
  });

  it('is left to right where the app has not said', () => {
    assert.equal(props('.a:dir(ltr) { opacity: 0.5 }')['opacity'], 0.5);
    assert.equal(props(RTL)['opacity'], undefined);
  });

  it('holds as Tailwind writes ltr: and rtl:, by the app or by an element that says its own', () => {
    assert.equal(props(TAILWIND_LTR)['opacity'], 0.5);
    assert.equal(props(TAILWIND_RTL)['opacity'], undefined);
    assert.equal(props(TAILWIND_RTL, 'rtl')['opacity'], 0.5);
    assert.equal(props(TAILWIND_RTL, 'ltr', { dir: 'rtl' })['opacity'], 0.5);
  });

  it('holds inside a media query only where both do', () => {
    const wide = `@media (min-width: 300px) { ${RTL} }`;
    assert.equal(props(wide, 'rtl')['opacity'], 0.5);
    assert.equal(props(wide, 'ltr')['opacity'], undefined);
    const narrow = `@media (max-width: 300px) { ${RTL} }`;
    assert.equal(props(narrow, 'rtl')['opacity'], undefined);
  });

  it('is as specific as the pseudo-class it is', () => {
    const css = `${RTL} .a { opacity: 1 }`;
    assert.equal(props(css, 'rtl')['opacity'], 0.5, 'over a class alone written after it');
  });
});

describe(':dir() more than once in a selector', () => {
  it('holds where each of them does', () => {
    const twice = '.a:dir(rtl):dir(rtl) { opacity: 0.5 }';
    assert.equal(props(twice, 'rtl')['opacity'], 0.5);
    assert.equal(props(twice, 'ltr')['opacity'], undefined);
    const listed = '.a:dir(rtl):where(:dir(rtl), [dir="rtl"]) { opacity: 0.5 }';
    assert.equal(props(listed, 'rtl')['opacity'], 0.5);
    assert.equal(props(listed, 'ltr')['opacity'], undefined);
  });

  it('never holds where two of them ask for different directions', () => {
    const both = '.a:dir(ltr):dir(rtl) { opacity: 0.5 }';
    assert.equal(props(both, 'rtl')['opacity'], undefined);
    assert.equal(props(both, 'ltr')['opacity'], undefined);
  });
});

describe(':dir() inside :is()', () => {
  it('is as specific as the most specific alternative beside it, as the whole :is() is', () => {
    // `:is(:dir(rtl), #chosen)` weighs what `#chosen` does for every element it matches.
    const css = '.a:is(:dir(rtl), #chosen) { opacity: 0.5 } .a.a { opacity: 1 }';
    assert.equal(props(css, 'rtl')['opacity'], 0.5);
    // Inside `:where()` it weighs nothing, and the later rule stands.
    const where = '.a:where(:dir(rtl), #chosen) { opacity: 0.5 } .a.a { opacity: 1 }';
    assert.equal(props(where, 'rtl')['opacity'], 1);
  });
});

describe(':dir() among the rules around it', () => {
  it('keeps the place it was written at, so a rule after it still comes after', () => {
    const css = '.a { opacity: 1 } .a:where(:dir(ltr)) { opacity: 0.5 } .a { opacity: 0.25 }';
    assert.equal(props(css)['opacity'], 0.25);
    const last = '.a { opacity: 1 } .a { opacity: 0.25 } .a:where(:dir(ltr)) { opacity: 0.5 }';
    assert.equal(props(last)['opacity'], 0.5);
  });
});
