/**
 * `@font-face` rules a hot swap takes away.
 *
 * A face is matched by family, weight and style. Once the sheet that declared it is edited to drop
 * or rename it, or removed, text stops being pointed at it, as a browser stops using a face whose
 * rule is gone. The face stays registered with the platform, which has no way to unregister one,
 * but nothing names it.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

const BOLD = "@font-face { font-family: Inter; src: url('./Inter-Bold.ttf'); font-weight: 700 }";
const TEXT = '.t { font-family: Inter; font-weight: 700 }';

/** Text in a bold Inter, from a component sheet, beside a global sheet that declares the face. */
function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const faces = compileCss(BOLD) as StyleSheet;
  engine.addGlobalSheet(faces);
  const text = engine.createElement('text', compileCss(TEXT) as StyleSheet);
  engine.addClass(text, 't');
  engine.appendChild(engine.root, text);
  engine.commit();
  return { engine, faces, family: () => flatten(fabric.committed)[0]?.props['fontFamily'] };
}

describe('a face a hot swap takes away', () => {
  it('is matched while its rule is there', () => {
    assert.equal(scene().family(), 'Inter-700');
  });

  it('is no longer matched once the edited sheet drops it', () => {
    const { engine, faces, family } = scene();
    engine.addGlobalSheet(compileCss('.unrelated { width: 1px }') as StyleSheet, faces);
    engine.commit();
    assert.equal(family(), 'Inter');
  });

  it('is no longer matched once the edited sheet renames it', () => {
    const { engine, faces, family } = scene();
    engine.addGlobalSheet(compileCss(BOLD.replace('Inter;', 'Grotesk;')) as StyleSheet, faces);
    engine.commit();
    assert.equal(family(), 'Inter');
  });

  it('is no longer matched once its sheet is removed', () => {
    const { engine, faces, family } = scene();
    engine.removeGlobalSheet(faces);
    engine.commit();
    assert.equal(family(), 'Inter');
  });
});
