/**
 * Tailwind 3, built by its real CLI and rendered by the engine.
 *
 * Tailwind 3 composes more across classes than 4 does. `.transform` reads `--tw-rotate`, which
 * `.rotate-45` sets; `.shadow` reads `--tw-ring-shadow`, which `.ring` sets; `.bg-blue-500` reads
 * `--tw-bg-opacity`, which `.bg-opacity-50` sets. Which of those a node has is a question only the
 * cascade can answer, so every test here renders a node and reads what it was committed with,
 * rather than inspecting the compiled sheet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, context: string, options: object): StyleSheet;
};

/** Tailwind 3's CLI output for exactly these classes, through the preset as the setup guide says. */
function build(classes: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tailwind-v3-'));
  const preset = require.resolve('@ng-native/tailwind/preset.cjs');
  writeFileSync(
    join(dir, 'tailwind.config.js'),
    `module.exports = { presets: [require(${JSON.stringify(preset)})], content: [{ raw: ${JSON.stringify(classes)} }] };`,
  );
  writeFileSync(
    join(dir, 'in.css'),
    '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
  );
  execFileSync(
    process.execPath,
    [
      require.resolve('tailwindcss-v3/lib/cli.js'),
      '-c',
      'tailwind.config.js',
      '-i',
      'in.css',
      '-o',
      'out.css',
    ],
    { cwd: dir, stdio: 'pipe' },
  );
  return readFileSync(join(dir, 'out.css'), 'utf8');
}

/**
 * One sheet built from every class a test mentions, so a rule can only be right if it ignores the
 * utilities a node does not wear. That is the failure this file exists for: `.translate-x-2`
 * picking up `.rotate-45`'s angle because both are in the sheet.
 */
function sheetFor(classes: string): StyleSheet {
  return compileCss(flattenTailwind(build(classes)), 'tailwind', { onUnsupported: () => {} });
}

/** Renders a parent wearing `outer` around a child wearing `inner`, and returns both's props. */
function render(sheet: StyleSheet, outer: string, inner = '') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet });
  const parent = engine.createElement('view');
  const child = engine.createElement('view');
  engine.setClasses(parent, outer);
  engine.setClasses(child, inner);
  engine.appendChild(engine.root, parent);
  engine.appendChild(parent, child);
  engine.commit();
  return { parent: committedProps(fabric, parent), child: committedProps(fabric, child) };
}

/** A committed transform as one object, so a test can name the functions it cares about. */
function transformOf(props: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, ...((props['transform'] as object[] | undefined) ?? []));
}

const TRANSFORMS = 'transform translate-x-2 rotate-45 scale-95';

describe('Tailwind 3', () => {
  it('moves a node by the translate it wears, and not by a rotate another class set', () => {
    const sheet = sheetFor(TRANSFORMS);
    const moved = transformOf(render(sheet, 'transform translate-x-2').parent);
    assert.equal(moved['translateX'], 8);
    assert.equal(moved['rotate'] ?? '0deg', '0deg', 'no rotate-45 on this node');
    assert.equal(moved['scaleX'] ?? 1, 1, 'no scale-95 on this node');
  });

  it('composes the transform utilities a node does wear', () => {
    const sheet = sheetFor(TRANSFORMS);
    const both = transformOf(render(sheet, 'transform translate-x-2 rotate-45').parent);
    assert.equal(both['translateX'], 8);
    assert.equal(both['rotate'], '45deg');
  });

  it('centres with a percentage translate, which the device cannot mix with a token', () => {
    // `-translate-x-1/2` is `-50%`, and the engine refuses a percentage beside a `var()` because
    // resolving it needs layout. Such a declaration is settled at build time instead.
    const sheet = sheetFor(`${TRANSFORMS} -translate-x-1/2 translate-y-2`);
    const centred = transformOf(render(sheet, 'transform -translate-x-1/2').parent);
    assert.equal(centred['translateX'], '-50%');
    assert.equal(centred['rotate'] ?? '0deg', '0deg');
  });

  it("does not hand a parent's rotate down to a child", () => {
    // Tailwind 3 resets every `--tw-*` on every element with `*`, which is what keeps a custom
    // property from inheriting here, where on the web it would.
    const sheet = sheetFor(TRANSFORMS);
    const { child } = render(sheet, 'transform rotate-45', 'transform translate-x-2');
    assert.equal(transformOf(child)['rotate'] ?? '0deg', '0deg');
  });

  it('filters by the filter utility a node wears, and not by one another class set', () => {
    // Filters are settled at build time, since the device refuses a filter list of tokens; a slot
    // the rule does not set has to come from the reset, not from the last utility in the file.
    const sheet = sheetFor('android:grayscale blur brightness-50');
    const { child } = render(sheet, 'platform-android', 'android:grayscale');
    assert.deepEqual(child['filter'], [{ grayscale: 1 }]);
  });

  it('paints a shadow without a ring, when another class in the sheet draws one', () => {
    const sheet = sheetFor('shadow ring ring-rose-500');
    const shadows = render(sheet, 'shadow').parent['boxShadow'] as { spreadDistance: number }[];
    assert.ok(shadows?.length, 'a shadow was painted');
    assert.ok(
      shadows.every((shadow) => shadow.spreadDistance <= 0),
      `no ring in ${JSON.stringify(shadows)}`,
    );
  });

  it('paints a ring in the colour and width the node asks for', () => {
    const sheet = sheetFor('ring ring-2 ring-rose-500 ring-blue-500');
    const shadows = render(sheet, 'ring-2 ring-rose-500').parent['boxShadow'] as {
      spreadDistance: number;
      color: string;
    }[];
    assert.ok(
      shadows?.some((s) => s.spreadDistance === 2 && s.color === 'rgb(244, 63, 94)'),
      JSON.stringify(shadows),
    );
  });

  it('keeps a colour solid unless an opacity utility says otherwise', () => {
    const sheet = sheetFor('bg-blue-500 bg-opacity-50');
    assert.equal(render(sheet, 'bg-blue-500').parent['backgroundColor'], 'rgb(59, 130, 246)');
    assert.equal(
      render(sheet, 'bg-blue-500 bg-opacity-50').parent['backgroundColor'],
      'rgba(59, 130, 246, 0.5)',
    );
  });

  it('fades text, border and divider colours by their opacity utilities', () => {
    const sheet = sheetFor(
      'text-rose-500 text-opacity-50 border border-zinc-200 border-opacity-25 ' +
        'divide-y divide-zinc-200 divide-opacity-50 bg-blue-500/50',
    );
    assert.equal(
      render(sheet, 'text-rose-500 text-opacity-50').parent['color'],
      'rgba(244, 63, 94, 0.5)',
    );
    assert.equal(render(sheet, 'text-rose-500').parent['color'], 'rgb(244, 63, 94)');
    assert.equal(
      render(sheet, 'border border-zinc-200 border-opacity-25').parent['borderTopColor'],
      'rgba(228, 228, 231, 0.25)',
    );
    assert.equal(
      render(sheet, 'bg-blue-500/50').parent['backgroundColor'],
      'rgba(59, 130, 246, 0.5)',
    );

    // The divider is drawn on the second child, from the parent's classes.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet });
    const list = engine.createElement('view');
    const [first, second] = [engine.createElement('view'), engine.createElement('view')];
    engine.setClasses(list, 'divide-y divide-zinc-200 divide-opacity-50');
    engine.appendChild(engine.root, list);
    engine.appendChild(list, first);
    engine.appendChild(list, second);
    engine.commit();
    assert.equal(committedProps(fabric, first)['borderTopWidth'], undefined);
    assert.equal(committedProps(fabric, second)['borderTopWidth'], 1);
    assert.equal(committedProps(fabric, second)['borderTopColor'], 'rgba(228, 228, 231, 0.5)');
  });

  it('spaces the children after the first', () => {
    const sheet = sheetFor('space-x-2 space-y-4');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet });
    const row = engine.createElement('view');
    const [first, second] = [engine.createElement('view'), engine.createElement('view')];
    engine.setClasses(row, 'space-x-2');
    engine.appendChild(engine.root, row);
    engine.appendChild(row, first);
    engine.appendChild(row, second);
    engine.commit();
    assert.equal(committedProps(fabric, first)['marginLeft'], undefined);
    assert.equal(committedProps(fabric, second)['marginLeft'], 8);
  });

  it('reads transform-gpu as the transform it is on native', () => {
    // `translate3d(x, y, 0)` is a hint to a browser's compositor; native has none to give it, and
    // the compiler refused the whole declaration.
    const refused: string[] = [];
    const sheet = compileCss(flattenTailwind(build('transform-gpu translate-x-2')), 'tailwind', {
      onUnsupported: (message: string) => refused.push(message),
    });
    assert.deepEqual(
      refused.filter((m) => /transform/.test(m)),
      [],
    );
    const gpu = sheet.rules.find((r) => r.compounds.at(-1)!.classes.includes('transform-gpu'));
    assert.ok(
      gpu?.deferred?.some((d) => d.props.includes('transform')),
      'transform-gpu compiled',
    );
  });

  it("says nothing about a browser's vendor-prefixed copy of a property", () => {
    // Tailwind 3 writes `-moz-column-gap` beside `column-gap`: the standard one is compiled, and a
    // warning for the copy is noise in every build.
    const refused: string[] = [];
    compileCss(flattenTailwind(build('gap-x-2 columns-2 object-cover')), 'tailwind', {
      onUnsupported: (message: string) => refused.push(message),
    });
    assert.deepEqual(
      refused.filter((m) => /-(moz|o|ms)-/.test(m)),
      [],
    );
  });

  it('keeps only the reset slots the device still reads', () => {
    // The `*` reset is matched on every element, so each slot in it is a token on every node. The
    // ones the build already settled are never read there, and cost a phone for nothing.
    const flat = flattenTailwind(build('transform rotate-45 translate-x-2 shadow ring-2'));
    const reset = /\*\s*\{([^}]*)\}/.exec(flat)?.[1] ?? '';
    assert.match(reset, /--tw-rotate:/, 'read on device by .transform');
    assert.match(reset, /--tw-ring-shadow:/, 'read on device by .shadow');
    assert.doesNotMatch(reset, /--tw-pan-x|--tw-ordinal|--tw-scroll-snap/, 'read by nothing here');
  });

  it('takes arbitrary values', () => {
    const sheet = sheetFor('bg-[#123456] w-[37px] transform translate-x-[10px] rotate-45');
    const { parent } = render(sheet, 'bg-[#123456] w-[37px] transform translate-x-[10px]');
    assert.equal(parent['backgroundColor'], 'rgb(18, 52, 86)');
    assert.equal(parent['width'], 37);
    assert.equal(transformOf(parent)['translateX'], 10);
    assert.equal(transformOf(parent)['rotate'] ?? '0deg', '0deg');
  });

  it("draws a ring in Tailwind's default colour, and inset when asked", () => {
    const sheet = sheetFor('ring ring-inset ring-rose-500');
    const plain = render(sheet, 'ring').parent['boxShadow'] as {
      spreadDistance: number;
      color: string;
      inset: boolean;
    }[];
    assert.ok(
      plain.some(
        (s) => s.spreadDistance === 3 && s.color === 'rgba(59, 130, 246, 0.5)' && !s.inset,
      ),
      JSON.stringify(plain),
    );
    const inset = render(sheet, 'ring ring-inset').parent['boxShadow'] as {
      spreadDistance: number;
      inset: boolean;
    }[];
    assert.ok(
      inset.some((s) => s.spreadDistance === 3 && s.inset),
      JSON.stringify(inset),
    );
  });

  it('paints a gradient from its from-, via- and to- classes', () => {
    const sheet = sheetFor('bg-gradient-to-r from-rose-500 via-white to-blue-500');
    const stops = (classes: string) =>
      (
        render(sheet, classes).parent['experimental_backgroundImage'] as {
          direction: unknown;
          colorStops: unknown[];
        }[]
      )?.[0];
    const rose = 'rgb(244, 63, 94)';
    const blue = 'rgb(59, 130, 246)';
    assert.deepEqual(stops('bg-gradient-to-r from-rose-500 to-blue-500'), {
      type: 'linear-gradient',
      direction: { type: 'angle', value: 90 },
      colorStops: [
        { color: rose, position: '0%' },
        { color: blue, position: '100%' },
      ],
    });
    assert.deepEqual(stops('bg-gradient-to-r from-rose-500 via-white to-blue-500')?.colorStops, [
      { color: rose, position: '0%' },
      { color: 'rgb(255, 255, 255)', position: '50%' },
      { color: blue, position: '100%' },
    ]);
  });
});

describe('the Tailwind 3 preset', () => {
  // Tailwind 3 reads no brace expansion in raw content, so each variant is written out.
  const VARIANTS = 'hover press hovered focus focus-visible disabled ios android web native dark';
  const PRESET =
    VARIANTS.split(' ')
      .map((variant) => `${variant}:bg-red-500`)
      .join(' ') +
    ' p-safe pb-safe pb-safe-4 min-pb-safe-4 mt-safe h-hairline border-b-hairline font-mono';
  let css = '';
  const selectorFor = (utility: string) => {
    const escaped = `.${utility.replace(/:/g, '\\:')}`;
    return css
      .split('\n')
      .filter((line) => line.includes(escaped) && line.includes('{'))
      .join(' ');
  };
  const declarationsOf = (utility: string) => {
    const at = css.indexOf(`\n.${utility} {`);
    return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('builds, and leaves preflight out', () => {
    css = build(PRESET);
    assert.doesNotMatch(css, /box-sizing: border-box/, 'no preflight');
  });

  it('gives hover: the press state, and a real hover where there is a pointer', () => {
    assert.match(selectorFor('hover:bg-red-500'), /:active/);
    assert.match(selectorFor('hover:bg-red-500'), /\[data-hover\]/);
    assert.doesNotMatch(selectorFor('hover:bg-red-500'), /:hover/);
    assert.match(selectorFor('press:bg-red-500'), /:active/);
    assert.match(selectorFor('hovered:bg-red-500'), /\[data-hover\]/);
  });

  it('makes focus-visible: focus, and both follow data-focus', () => {
    for (const variant of ['focus', 'focus-visible']) {
      assert.match(selectorFor(`${variant}:bg-red-500`), /:focus\b/);
      assert.match(selectorFor(`${variant}:bg-red-500`), /\[data-focus\]/);
      assert.doesNotMatch(selectorFor(`${variant}:bg-red-500`), /:focus-visible/);
    }
  });

  it('follows data-disabled for disabled:', () => {
    assert.match(selectorFor('disabled:bg-red-500'), /\[data-disabled\]/);
  });

  it('matches the platform and dark variants against a class on an ancestor', () => {
    const sheet = compileCss(flattenTailwind(css), 'tailwind', { onUnsupported: () => {} });
    const red = 'rgb(239, 68, 68)';
    const on = (root: string, classes: string) =>
      render(sheet, root, classes).child['backgroundColor'];
    assert.equal(on('platform-ios', 'ios:bg-red-500'), red);
    assert.equal(on('platform-android', 'ios:bg-red-500'), undefined);
    assert.equal(on('platform-android', 'android:bg-red-500'), red);
    assert.equal(on('platform-android', 'native:bg-red-500'), red);
    assert.equal(on('platform-web', 'web:bg-red-500'), red);
    assert.equal(on('dark', 'dark:bg-red-500'), red);
    assert.equal(on('', 'dark:bg-red-500'), undefined);
  });

  it('gives group- and peer- variants the same touch meanings, rendered', () => {
    // Tailwind 3 builds `group-hover:` and `peer-hover:` from `:hover` itself, not from the
    // `hover` variant this preset redefines, so without their own definitions they compiled to a
    // selector the engine refuses.
    const classes =
      'group peer group-hover:bg-red-500 group-focus:bg-green-500 group-focus-visible:bg-blue-500 ' +
      'peer-hover:bg-red-500 peer-focus:bg-green-500 group-disabled:bg-amber-500 peer-disabled:bg-amber-500';
    const built = build(classes);
    for (const variant of ['group-hover', 'peer-hover']) {
      const line = built.split('\n').find((l) => l.includes(`${variant}\\:bg-red-500`)) ?? '';
      assert.match(line, /:active/, variant);
      assert.doesNotMatch(line, /:hover/, variant);
    }
    const refused: string[] = [];
    const sheet = compileCss(flattenTailwind(built), 'tailwind', {
      onUnsupported: (message: string) => refused.push(message),
    });
    assert.deepEqual(
      refused.filter((m) => !m.includes("dropped '--")),
      [],
    );

    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet });
    const group = engine.createElement('view');
    const inGroup = engine.createElement('view');
    const peer = engine.createElement('view');
    const afterPeer = engine.createElement('view');
    engine.setClasses(group, 'group');
    engine.setClasses(
      inGroup,
      'group-hover:bg-red-500 group-focus:bg-green-500 group-disabled:bg-amber-500',
    );
    engine.setClasses(peer, 'peer');
    engine.setClasses(
      afterPeer,
      'peer-hover:bg-red-500 peer-focus:bg-green-500 peer-disabled:bg-amber-500',
    );
    engine.appendChild(engine.root, group);
    engine.appendChild(group, inGroup);
    engine.appendChild(engine.root, peer);
    engine.appendChild(engine.root, afterPeer);
    engine.commit();
    const bg = (node: unknown) => committedProps(fabric, node)['backgroundColor'];
    assert.equal(bg(inGroup), undefined);
    assert.equal(bg(afterPeer), undefined);

    engine.setProp(group, 'data-hover', '');
    engine.setProp(peer, 'data-hover', '');
    engine.commit();
    assert.equal(bg(inGroup), 'rgb(239, 68, 68)', 'group-hover:');
    assert.equal(bg(afterPeer), 'rgb(239, 68, 68)', 'peer-hover:');
    engine.setProp(group, 'data-hover', null);
    engine.setProp(peer, 'data-hover', null);

    engine.setProp(group, 'data-focus', '');
    engine.setProp(peer, 'data-focus', '');
    engine.commit();
    assert.equal(bg(inGroup), 'rgb(34, 197, 94)', 'group-focus:');
    assert.equal(bg(afterPeer), 'rgb(34, 197, 94)', 'peer-focus:');
    engine.setProp(group, 'data-focus', null);
    engine.setProp(peer, 'data-focus', null);

    engine.setProp(group, 'data-disabled', '');
    engine.setProp(peer, 'data-disabled', '');
    engine.commit();
    assert.equal(bg(inGroup), 'rgb(245, 158, 11)', 'group-disabled:');
    assert.equal(bg(afterPeer), 'rgb(245, 158, 11)', 'peer-disabled:');
  });

  it('keeps a stacked platform, dark and state variant', () => {
    const classes =
      'dark:ios:bg-red-500 ios:dark:bg-green-500 ios:hover:bg-blue-500 dark:hover:bg-amber-500';
    const refused: string[] = [];
    const sheet = compileCss(flattenTailwind(build(classes)), 'tailwind', {
      onUnsupported: (message: string) => refused.push(message),
    });
    assert.deepEqual(
      refused.filter((m) => !m.includes("dropped '--")),
      [],
    );
    const on = (root: string, cls: string, hover = false) => {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { globalStyles: sheet });
      const parent = engine.createElement('view');
      const child = engine.createElement('view');
      engine.setClasses(parent, root);
      engine.setClasses(child, cls);
      if (hover) engine.setProp(child, 'data-hover', '');
      engine.appendChild(engine.root, parent);
      engine.appendChild(parent, child);
      engine.commit();
      return committedProps(fabric, child)['backgroundColor'];
    };
    assert.equal(on('platform-ios dark', 'dark:ios:bg-red-500'), 'rgb(239, 68, 68)');
    assert.equal(on('platform-ios', 'dark:ios:bg-red-500'), undefined);
    assert.equal(on('platform-ios dark', 'ios:dark:bg-green-500'), 'rgb(34, 197, 94)');
    assert.equal(on('platform-ios', 'ios:hover:bg-blue-500', true), 'rgb(59, 130, 246)');
    assert.equal(on('platform-android', 'ios:hover:bg-blue-500', true), undefined);
    assert.equal(on('dark', 'dark:hover:bg-amber-500', true), 'rgb(245, 158, 11)');
  });

  it('reads the safe area from the tokens the device supplies', () => {
    assert.match(declarationsOf('pb-safe'), /padding-bottom: var\(--safe-area-inset-bottom, 0px\)/);
    assert.match(declarationsOf('mt-safe'), /margin-top: var\(--safe-area-inset-top, 0px\)/);
    assert.match(declarationsOf('p-safe'), /padding-left: var\(--safe-area-inset-left, 0px\)/);
    assert.match(
      declarationsOf('pb-safe-4'),
      /padding-bottom: calc\(var\(--safe-area-inset-bottom, 0px\) \+ 1rem\)/,
    );
    assert.match(
      declarationsOf('min-pb-safe-4'),
      /padding-bottom: max\(var\(--safe-area-inset-bottom, 0px\), 1rem\)/,
    );
  });

  it('draws a hairline from the device token', () => {
    assert.match(declarationsOf('h-hairline'), /height: var\(--hairline, 1px\)/);
    assert.match(
      declarationsOf('border-b-hairline'),
      /border-bottom-width: var\(--hairline, 1px\)/,
    );
  });

  it('names a monospace font both platforms have', () => {
    assert.match(declarationsOf('font-mono'), /font-family: Courier New/);
    assert.match(css, /\.platform-ios \.font-mono\s*\{\s*font-family: Menlo/);
    assert.match(css, /\.platform-android \.font-mono\s*\{\s*font-family: monospace/);
  });
});

/** The props a node was last committed with. */
function committedProps(fabric: FakeFabric, node: unknown): Record<string, unknown> {
  const all = (n: FakeFabricNode): FakeFabricNode[] => [n, ...n.children.flatMap(all)];
  const found = fabric.committed.flatMap(all).find((n) => n.instanceHandle === node);
  assert.ok(found, 'committed');
  return found.props;
}
