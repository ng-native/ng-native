/**
 * The state attributes the presets read, `data-disabled`, `data-focus` and `data-hover`, written
 * as `"false"`. An Angular attribute binding to a boolean writes the string, and so do component
 * libraries that publish their state that way, and a state that is off is not a state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { build, buildV3 } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

const VARIANTS = [
  ['disabled', 'data-disabled'],
  ['focus', 'data-focus'],
  ['focus-visible', 'data-focus'],
  ['hover', 'data-hover'],
  ['hovered', 'data-hover'],
] as const;
const CLASSES = VARIANTS.map(([variant]) => `${variant}:opacity-50`).join(' ');

/** The opacity a view with `utility` commits, with `attribute` set to `value`. */
function opacityWith(css: string, utility: string, attribute: string, value: unknown): unknown {
  const reports: string[] = [];
  const sheet = compileCss(css, 'tw', { onUnsupported: (m: string) => reports.push(m) });
  assert.deepEqual(
    reports.filter((report) => report.includes(utility)),
    [],
  );
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const node = engine.createElement('view');
  engine.setClasses(node, utility);
  if (value !== undefined) engine.setProp(node, attribute, value);
  engine.appendChild(engine.root, node);
  engine.commit();
  return fabric.committed[0]!.props['opacity'];
}

for (const [name, css] of [
  ['Tailwind 4', () => flattenTailwind(build('native', CLASSES))],
  ['Tailwind 3', () => buildV3(CLASSES)],
] as const) {
  describe(`a state attribute written as "false", ${name}`, () => {
    for (const [variant, attribute] of VARIANTS) {
      it(`${variant}: reads ${attribute} as off when it is "false", and on otherwise`, () => {
        const sheet = css();
        const utility = `${variant}:opacity-50`;
        assert.equal(opacityWith(sheet, utility, attribute, undefined), undefined);
        assert.equal(opacityWith(sheet, utility, attribute, 'false'), undefined);
        assert.equal(opacityWith(sheet, utility, attribute, false), undefined);
        for (const on of ['', 'true', true]) {
          assert.equal(opacityWith(sheet, utility, attribute, on), 0.5, JSON.stringify(on));
        }
      });
    }
  });
}

describe('the web preset', () => {
  it('reads the same attributes the same way', () => {
    const css = build('web', CLASSES);
    for (const attribute of ['data-disabled', 'data-focus', 'data-hover']) {
      assert.match(
        css,
        new RegExp(`\\[${attribute}\\]:where\\(:not\\(\\[${attribute}=`),
        attribute,
      );
    }
  });
});
