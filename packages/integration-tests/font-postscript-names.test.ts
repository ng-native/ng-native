/**
 * The name SwiftUI finds a face by.
 *
 * A face is registered with expo-font under the name the app's CSS gives it (`Brand`, `Brand-700`),
 * which React Native's text finds through expo-font's alias. SwiftUI's `font` modifier, through
 * `@expo/ui`, looks a name up in CoreText instead, which knows only the font file's own PostScript
 * name: given the alias it draws the system font, without a word. So the build reads each face's
 * PostScript name out of its file, and a `font` modifier on a SwiftUI view that names a face the
 * way a `<text>` would is committed with the name SwiftUI can find.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expoViewName, registerExpoUiViews } from '@ng-native/expo';
import { FontRegistry } from '@ng-native/expo/fonts';
import { Engine, registerViewName, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { collection, nameTable, named, sfnt, woff } from './font-files.ts';

const require = createRequire(import.meta.url);
const { transformAngular, takeResourcesRead } = require('@ng-native/metro/angular-transform.cjs');
const { compileSheetModule } = require('@ng-native/tailwind/config.cjs') as {
  compileSheetModule(
    css: string,
    context: string,
    paths: { input: string; output: string },
  ): string;
};

/** A directory holding the files given, removed once `run` is done. */
function scratch<T>(files: Record<string, Buffer | string>, run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'ngn-font-names-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), contents);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The sheet a component with `css` as its styles compiles to, as emitted source. */
function compiledFrom(dir: string, css: string): string {
  const source = `
    import { Component } from '@angular/core';
    @Component({ selector: 'x-a', template: '', styles: \`${css}\` })
    export class A {}
  `;
  return transformAngular(source, path.join(dir, 'a.ts')).code as string;
}

const face = (file: string, extra = '') =>
  `@font-face { font-family: Brand; src: url('${file}');${extra} }`;

/** Every `postScriptName` the emitted source gives a face, in order. */
const postScriptNames = (code: string) =>
  [...code.matchAll(/"postScriptName":"([^"]*)"/g)].map((match) => match[1]);

/** Runs `run` with `console.warn` recorded, and restores it. */
function warnings<T>(run: () => T): { result: T; warned: string[] } {
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warned.push(args.join(' '));
  try {
    return { result: run(), warned };
  } finally {
    console.warn = original;
  }
}

/** Runs `run` with `console.warn` recorded, and restores it once it settles. */
async function warningsAsync(run: () => Promise<void>): Promise<string[]> {
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warned.push(args.join(' '));
  try {
    await run();
    return warned;
  } finally {
    console.warn = original;
  }
}

describe('reading a face file at build time', () => {
  it('gives a face the PostScript name its TrueType file says', () => {
    const code = scratch({ 'Brand-Bold.ttf': sfnt(named('Brand-Bold')) }, (dir) =>
      compiledFrom(dir, face('./Brand-Bold.ttf', ' font-weight: 700;')),
    );
    assert.deepEqual(postScriptNames(code), ['Brand-Bold']);
  });

  it('reads an OpenType file, a WOFF, and the first font of a collection', () => {
    const code = scratch(
      {
        'a.otf': sfnt(named('Brand-Regular'), 0x4f54544f),
        'b.woff': woff(named('Brand-Italic')),
        'c.ttc': collection(named('Brand-Light'), named('Brand-Heavy')),
      },
      (dir) =>
        compiledFrom(
          dir,
          face('./a.otf') +
            face('./b.woff', ' font-style: italic;') +
            face('./c.ttc', ' font-weight: 300;'),
        ),
    );
    assert.deepEqual(postScriptNames(code), ['Brand-Regular', 'Brand-Italic', 'Brand-Light']);
  });

  it('takes a Mac name record where the file has no Windows one', () => {
    const code = scratch({ 'a.ttf': sfnt(named('Brand-Mac', 1)) }, (dir) =>
      compiledFrom(dir, face('./a.ttf')),
    );
    assert.deepEqual(postScriptNames(code), ['Brand-Mac']);
  });

  it('takes the Windows record over a Mac one, as CoreText does', () => {
    const both = nameTable([
      { platform: 1, id: 6, value: 'Brand-Mac' },
      { platform: 3, id: 6, value: 'Brand-Windows' },
    ]);
    const code = scratch({ 'a.ttf': sfnt(both) }, (dir) => compiledFrom(dir, face('./a.ttf')));
    assert.deepEqual(postScriptNames(code), ['Brand-Windows']);
  });

  it('passes over a record of a platform it does not read, even one it could not decode', () => {
    // ISO's platform, long deprecated: an odd length is no UTF-16, and is not this reader's to decode.
    const iso = nameTable([
      { platform: 2, id: 6, value: '', bytes: Buffer.from('Odd', 'latin1') },
      { platform: 3, id: 6, value: 'Brand-Windows' },
    ]);
    const code = scratch({ 'a.ttf': sfnt(iso) }, (dir) => compiledFrom(dir, face('./a.ttf')));
    assert.deepEqual(postScriptNames(code), ['Brand-Windows']);
  });

  it('reads the file from the project root, which Metro names a file from', () => {
    const code = scratch({ 'src/fonts/a.ttf': sfnt(named('Brand-Rooted')) }, (dir) => {
      const source = `
        import { Component } from '@angular/core';
        @Component({ selector: 'x-a', template: '', styles: \`${face('./fonts/a.ttf')}\` })
        export class A {}
      `;
      return transformAngular(source, 'src/a.ts', { projectRoot: dir }).code as string;
    });
    assert.deepEqual(postScriptNames(code), ['Brand-Rooted']);
  });

  it('reads a face its external stylesheet declares, beside the stylesheet', () => {
    scratch(
      { 'a.css': face('./fonts/a.ttf'), 'fonts/a.ttf': sfnt(named('Brand-External')) },
      (dir) => {
        const source = `
          import { Component } from '@angular/core';
          @Component({ selector: 'x-a', template: '', styleUrl: './a.css' })
          export class A {}
        `;
        const filename = path.join(dir, 'a.ts');
        const { code } = transformAngular(source, filename);
        assert.deepEqual(postScriptNames(code), ['Brand-External']);
        assert.deepEqual(takeResourcesRead(filename), [
          path.join(dir, 'a.css'),
          path.join(dir, 'fonts', 'a.ttf'),
        ]);
      },
    );
  });

  it('reads a face named from another directory, and one in a package', () => {
    const code = scratch(
      {
        'fonts/Brand.ttf': sfnt(named('Brand-Local')),
        'node_modules/brand-font/Brand.ttf': sfnt(named('Brand-Packaged')),
      },
      (dir) =>
        compiledFrom(
          dir,
          face('./fonts/Brand.ttf') + face('brand-font/Brand.ttf', ' font-weight: 700;'),
        ),
    );
    assert.deepEqual(postScriptNames(code), ['Brand-Local', 'Brand-Packaged']);
  });

  it('warns about a file whose name it cannot read, and leaves the face without one', () => {
    const { result: code, warned } = scratch(
      { 'a.woff2': Buffer.from('wOF2 and then brotli'), 'b.ttf': Buffer.from('not a font') },
      (dir) =>
        warnings(() =>
          compiledFrom(dir, face('./a.woff2') + face('./b.ttf', ' font-weight: 700;')),
        ),
    );
    assert.deepEqual(postScriptNames(code), []);
    assert.equal(warned.length, 2, warned.join('\n'));
    assert.match(warned[0]!, /a\.woff2/);
    assert.match(warned[0]!, /PostScript name/);
    assert.match(warned[1]!, /b\.ttf/);
  });

  it('says nothing of a file that is not there, which the bundler reports itself', () => {
    const { result: code, warned } = scratch({}, (dir) =>
      warnings(() => compiledFrom(dir, face('./missing.ttf'))),
    );
    assert.deepEqual(postScriptNames(code), []);
    assert.deepEqual(warned, []);
  });

  it('counts the file among what the transform read, so a changed file misses the cache', () => {
    scratch({ 'a.ttf': sfnt(named('Brand-Bold')) }, (dir) => {
      compiledFrom(dir, face('./a.ttf'));
      assert.deepEqual(takeResourcesRead(path.join(dir, 'a.ts')), [path.join(dir, 'a.ttf')]);
    });
  });

  it('gives a face in the Tailwind entry its name, from where the entry is', () => {
    const code = scratch({ 'fonts/Brand.ttf': sfnt(named('Brand-Tailwind')) }, (dir) =>
      compileSheetModule(face('./fonts/Brand.ttf'), 'styles.css', {
        input: path.join(dir, 'styles.css'),
        output: path.join(dir, '.angular-native', 'app.tailwind.js'),
      }),
    );
    assert.deepEqual(postScriptNames(code), ['Brand-Tailwind']);
  });

  it('warns about an unreadable face in the Tailwind entry once, however often it is rebuilt', () => {
    const { warned } = scratch({ 'fonts/Brand.woff2': Buffer.from('wOF2') }, (dir) =>
      warnings(() => {
        for (let i = 0; i < 2; i++) {
          compileSheetModule(face('./fonts/Brand.woff2'), 'styles.css', {
            input: path.join(dir, 'styles.css'),
            output: path.join(dir, '.angular-native', 'app.tailwind.js'),
          });
        }
      }),
    );
    assert.equal(
      warned.filter((line) => line.includes('Brand.woff2')).length,
      1,
      warned.join('\n'),
    );
  });
});

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** The faces of a sheet that declared Brand in two weights, each with its PostScript name. */
const BRAND: StyleSheet = {
  rules: [],
  fonts: [
    { family: 'Brand', source: 1, postScriptName: 'Brand-Regular' },
    { family: 'Brand', source: 2, weight: 700, postScriptName: 'Brand-Bold' },
  ],
};

/** A SwiftUI text with the modifiers given, beside a global sheet that declares Brand. */
function scene(modifiers: readonly Record<string, unknown>[], platform: 'ios' | 'android' = 'ios') {
  registerExpoUiViews(platform);
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  engine.addGlobalSheet(BRAND);
  const text = engine.createElement('ui-text');
  engine.setProp(text, 'modifiers', modifiers);
  engine.appendChild(engine.root, text);
  engine.commit();
  const committed = () =>
    flatten(fabric.committed).find((node) => /TextView/.test(node.viewName))!.props['modifiers'] as
      readonly Record<string, unknown>[] | undefined;
  return { engine, text, committed, fabric };
}

const font = (family: string) => ({ $type: 'font', family, size: 17 });

describe('a font modifier on a SwiftUI view', () => {
  it('is committed with the PostScript name of the face it names', () => {
    const { committed } = scene([{ $type: 'padding', all: 4 }, font('Brand-700')]);
    assert.deepEqual(committed(), [
      { $type: 'padding', all: 4 },
      { $type: 'font', family: 'Brand-Bold', size: 17 },
    ]);
  });

  it('takes the last of two faces declared under one name, as expo-font registers it', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    engine.addGlobalSheet({
      rules: [],
      fonts: [
        { family: 'Twice', source: 1, weight: 700, postScriptName: 'Twice-First' },
        { family: 'Twice', source: 2, weight: 700, postScriptName: 'Twice-Second' },
      ],
    });
    registerExpoUiViews('ios');
    const text = engine.createElement('ui-text');
    engine.setProp(text, 'modifiers', [font('Twice-700')]);
    engine.appendChild(engine.root, text);
    engine.commit();
    const modifiers = flatten(fabric.committed)[0]!.props['modifiers'] as Record<string, unknown>[];
    assert.equal(modifiers[0]!['family'], 'Twice-Second');
  });

  it('takes the bare family as the face registered under it, as expo-font does', () => {
    assert.equal(scene([font('Brand')]).committed()?.[0]?.['family'], 'Brand-Regular');
  });

  it("rewrites the segmented picker's copy of the modifier as well", () => {
    const { committed } = scene([{ $type: 'ngNativeSegmentedFont', family: 'Brand-700' }]);
    assert.equal(committed()?.[0]?.['family'], 'Brand-Bold');
  });

  it('leaves a PostScript name, a system font and a family nothing declared as written', () => {
    const modifiers = [
      font('Brand-Bold'),
      font('Helvetica'),
      font('Other-700'),
      { $type: 'accessibilityLabel', family: 'Brand-700' },
    ];
    assert.equal(scene(modifiers).committed(), modifiers, 'the same list, not a copy');
  });

  it('commits a view with no modifiers as it did', () => {
    registerExpoUiViews('ios');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    engine.addGlobalSheet(BRAND);
    engine.appendChild(engine.root, engine.createElement('ui-text'));
    engine.commit();
    assert.equal(flatten(fabric.committed)[0]!.props['modifiers'], undefined);
  });

  it('takes a face of a weight and a style by either alone, unless a face declared it', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    engine.addGlobalSheet({
      rules: [],
      fonts: [
        {
          family: 'Serif',
          source: 1,
          weight: 700,
          style: 'italic',
          postScriptName: 'Serif-BoldItalic',
        },
        { family: 'Serif', source: 2, weight: 700, postScriptName: 'Serif-Bold' },
      ],
    });
    registerExpoUiViews('ios');
    const text = engine.createElement('ui-text');
    engine.setProp(text, 'modifiers', [font('Serif-700'), font('Serif-italic')]);
    engine.appendChild(engine.root, text);
    engine.commit();
    const modifiers = flatten(fabric.committed)[0]!.props['modifiers'] as Record<string, unknown>[];
    assert.deepEqual(
      modifiers.map((modifier) => modifier['family']),
      ['Serif-Bold', 'Serif-BoldItalic'],
    );
  });

  it('takes a face a sheet first used later declares, in a view committed before it', () => {
    const { engine, committed } = scene([font('Late-700')]);
    assert.equal(committed()?.[0]?.['family'], 'Late-700');
    const late: StyleSheet = {
      rules: [],
      fonts: [{ family: 'Late', source: 4, weight: 700, postScriptName: 'Late-Bold' }],
    };
    engine.appendChild(engine.root, engine.createElement('view', late));
    engine.commit();
    assert.equal(committed()?.[0]?.['family'], 'Late-Bold');
  });

  it('keeps the modifiers it does not rewrite as they were given', () => {
    const padding = { $type: 'padding', all: 4 };
    assert.equal(scene([padding, font('Brand-700')]).committed()?.[0], padding);
  });

  it('is left alone once its view is registered again without saying how', () => {
    registerExpoUiViews('ios');
    const { committed: before } = scene([font('Brand-700')]);
    assert.equal(before()?.[0]?.['family'], 'Brand-Bold');
    const name = expoViewName('ExpoUI', 'TextView');
    try {
      registerViewName('ui-text', name, undefined, { textContent: 'text' });
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1);
      engine.addGlobalSheet(BRAND);
      const text = engine.createElement('ui-text');
      engine.setProp(text, 'modifiers', [font('Brand-700')]);
      engine.appendChild(engine.root, text);
      engine.commit();
      const modifiers = flatten(fabric.committed)[0]!.props['modifiers'] as Record<
        string,
        unknown
      >[];
      assert.equal(modifiers[0]!['family'], 'Brand-700');
    } finally {
      registerExpoUiViews('ios');
    }
  });

  it('commits the same list again while nothing changed, so native is not sent it twice', () => {
    const { engine, text, committed, fabric } = scene([font('Brand-700')]);
    const first = committed();
    const before = fabric.committed;
    engine.setProp(text, 'text', 'Olly');
    engine.commit();
    assert.notEqual(fabric.committed, before, 'something else was committed');
    assert.equal(committed(), first);
  });

  it('follows a new list, and the face a hot swap gives the family', () => {
    const { engine, text, committed } = scene([font('Brand-700')]);
    engine.setProp(text, 'modifiers', [font('Brand')]);
    engine.commit();
    assert.equal(committed()?.[0]?.['family'], 'Brand-Regular');

    const renamed: StyleSheet = {
      rules: [],
      fonts: [{ family: 'Brand', source: 3, postScriptName: 'Brand-Book' }],
    };
    engine.addGlobalSheet(renamed, BRAND);
    engine.commit();
    assert.equal(committed()?.[0]?.['family'], 'Brand-Book');
  });

  it('goes back to the name as written once the sheet declaring the face is removed', () => {
    const { engine, committed } = scene([font('Brand-700')]);
    engine.removeGlobalSheet(BRAND);
    engine.commit();
    assert.equal(committed()?.[0]?.['family'], 'Brand-700');
  });

  it('is left alone on Android, where Compose finds the name the face was registered under', () => {
    try {
      const modifiers = [font('Brand-700')];
      assert.equal(scene(modifiers, 'android').committed(), modifiers);
    } finally {
      registerExpoUiViews('ios');
    }
  });
});

describe('a font modifier naming a face SwiftUI cannot find', () => {
  /** expo-font, as far as `FontRegistry` reads it: everything loads. */
  const native = {
    loaded: new Set<string>(),
    async loadAsync(map: Record<string, unknown>) {
      for (const name of Object.keys(map)) this.loaded.add(name);
    },
    isLoaded(name: string) {
      return this.loaded.has(name);
    },
    getLoadedFonts() {
      return [...this.loaded];
    },
  };

  it('warns once, naming the family, when the face was loaded by hand under that name', async () => {
    await new FontRegistry(native).load({ 'Hand Lettered': 1 });
    const { warned } = warnings(() => {
      scene([font('Hand Lettered')]);
      scene([font('Hand Lettered')]);
    });
    assert.equal(warned.length, 1, warned.join('\n'));
    assert.match(warned[0]!, /'Hand Lettered'/);
    assert.match(warned[0]!, /PostScript name/);
  });

  it('warns of a view committed while the font was still loading, once it registers', async () => {
    let finish!: () => void;
    const slow = {
      ...native,
      loadAsync(map: Record<string, unknown>) {
        return new Promise<void>((resolve) => {
          finish = () => {
            for (const name of Object.keys(map)) native.loaded.add(name);
            resolve();
          };
        });
      },
    };
    const loading = new FontRegistry(slow).load({ 'Still Loading': 1 });
    const { warned } = warnings(() => scene([font('Still Loading')]));
    assert.deepEqual(warned, [], 'nothing is registered yet');
    const after = await warningsAsync(async () => {
      finish();
      await loading;
    });
    assert.equal(after.length, 1, after.join('\n'));
    assert.match(after[0]!, /'Still Loading'/);
  });

  it('says nothing of a name whose load failed, which expo-font never registered', async () => {
    const failing = {
      ...native,
      async loadAsync() {
        throw new Error('no such file');
      },
    };
    await assert.rejects(new FontRegistry(failing).load({ 'Never Loaded': 1 }));
    const { warned } = warnings(() => scene([font('Never Loaded')]));
    assert.deepEqual(warned, []);
  });

  it('says nothing of a system font, or of a face it could rewrite', () => {
    // A name no other test uses: each family is warned about once a process.
    const { warned } = warnings(() => scene([font('Menlo-Regular'), font('Brand-700')]));
    assert.deepEqual(warned, []);
  });
});
