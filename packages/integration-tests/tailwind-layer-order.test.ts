/**
 * A component class in `@layer components`, written after the utilities are imported, as an app
 * writes one: a utility beside it wins, because the layer is under the utilities wherever its
 * rules are written.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { build } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

function committed(css: string, classes: string): Record<string, unknown> {
  const sheet = compileCss(flattenTailwind(css), 'tw', { onUnsupported: () => {} });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const node = engine.createElement('view');
  engine.setClasses(node, classes);
  engine.appendChild(engine.root, node);
  engine.commit();
  return fabric.committed[0]!.props;
}

describe('a component class in the components layer', () => {
  // The order `@import 'tailwindcss'` declares, which the split imports the presets use leave out.
  const app = `
    @layer theme, base, components, utilities;
    @layer components {
      .card { @apply rounded-md opacity-50; }
    }
    @layer base {
      .card { opacity: 0.25; }
    }
  `;

  it('gives way to a utility beside it, and beats the base layer', () => {
    const css = build('native', 'rounded-full rounded-md opacity-50', app);
    assert.equal(committed(css, 'card')['borderTopLeftRadius'], 6);
    assert.equal(committed(css, 'card')['opacity'], 0.5, 'components over base');
    assert.ok((committed(css, 'card rounded-full')['borderTopLeftRadius'] as number) > 1000);
  });

  it('orders layers by first mention when nothing declares an order, as a browser does', () => {
    const undeclared = app.replace('@layer theme, base, components, utilities;', '');
    const css = build('native', 'rounded-md opacity-50', undeclared);
    // `components` is named before `base` here, so `base` is the later layer and wins.
    assert.equal(committed(css, 'card')['opacity'], 0.25);
  });
});
