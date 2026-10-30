/**
 * The two places a style sheet can arrive as a silent `null`: `styleSheetOf()` called from a
 * static field of the component's own class, which runs before Angular defines the component and
 * the build attaches its sheet, and `globalStyles: null` (or a null sheet to `loadFonts()`), which
 * the engine takes as "no global sheet". Each says so once in development, and never in a release
 * build or for the cases that are meant.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { loadFonts } from '@ng-native/expo/fonts';
import { styleSheetOf } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Runs `body` with `__DEV__` as given and `console.warn` captured, restoring both. */
async function warnings(dev: boolean | undefined, body: () => unknown): Promise<string[]> {
  const global = globalThis as { __DEV__?: boolean };
  const hadDev = '__DEV__' in global;
  const previousDev = global.__DEV__;
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (...args: unknown[]) => void said.push(args.map(String).join(' '));
  try {
    if (dev === undefined) delete global.__DEV__;
    else global.__DEV__ = dev;
    await body();
  } finally {
    console.warn = warn;
    if (hadDev) global.__DEV__ = previousDev;
    else delete global.__DEV__;
  }
  return said.filter((message) => message.startsWith('[angular-native]'));
}

const COMPONENTS = `import { Component, Directive, Pipe } from '@angular/core';
import { styleSheetOf } from '@ng-native/fabric';

@Component({ selector: 'x-a', template: '', styles: ['a { color: red }'] })
export class A {
  static sheet = styleSheetOf(A);
  static again = styleSheetOf(A);
}
export const later = styleSheetOf(A);

@Component({ selector: 'x-b', template: '' })
export class Plain {}
export const plain = styleSheetOf(Plain);

@Directive({ selector: '[x-d]' })
export class D {}
export const directive = styleSheetOf(D);

@Component({ selector: 'x-c', template: '', styles: ['c { color: blue }'] })
export class Child extends D {
  static sheet = styleSheetOf(Child);
}

@Component({ selector: 'x-p', template: '', styles: ['p { color: red }'] })
export class Parent {}
export const parent = styleSheetOf(Parent);

@Component({ selector: 'x-k', template: '', styles: ['k { color: blue }'] })
export class Kid extends Parent {
  static sheet = styleSheetOf(Kid);
}
export const kid = styleSheetOf(Kid);

export class Undecorated extends Plain {}
export const undecorated = styleSheetOf(Undecorated);

export class UnderStyled extends Parent {}
export const underStyled = styleSheetOf(UnderStyled);

@Pipe({ name: 'x' })
export class P {
  transform(value: unknown) {
    return value;
  }
}
export const pipe = styleSheetOf(P);

@Component({ selector: 'x-n', template: '' })
export class NoStyles {
  static sheet = styleSheetOf(NoStyles);
}

@Directive({ selector: '[x-e]' })
export class StaticDirective {
  static sheet = styleSheetOf(StaticDirective);
}

export class StaticUnderStyled extends Parent {
  static sheet = styleSheetOf(StaticUnderStyled);
}
`;

const ROOT = `import { Component } from '@angular/core';

@Component({ selector: 'x-root', template: '' })
export class Root {}
`;

let compiles = 0;

/** A fresh module each time, so each run defines its classes anew, with the warnings it says. */
async function compiled(
  dev: boolean | undefined,
): Promise<{ said: string[]; mod: Record<string, unknown> }> {
  let mod: Record<string, unknown> = {};
  const name = `missing-style-sheet-${compiles++}`;
  const said = await warnings(dev, async () => {
    mod = await compileSource(COMPONENTS, fixture(`${name}.ts`), fixture(`${name}.generated.ts`));
  });
  return { said, mod };
}

describe('styleSheetOf() in a static field of its own class', () => {
  it('warns once in development, naming the class', async () => {
    const { said, mod } = await compiled(true);
    assert.equal((mod['A'] as { sheet: unknown }).sheet, null);
    const about = said.filter((message) => message.includes('styleSheetOf(A)'));
    assert.equal(about.length, 1, said.join('\n'));
    assert.match(about[0]!, /static field/);
  });

  it('warns for a component whose base class is a defined directive', async () => {
    const { said, mod } = await compiled(true);
    assert.equal((mod['Child'] as { sheet: unknown }).sheet, null);
    const about = said.filter((message) => message.includes('styleSheetOf(Child)'));
    assert.equal(about.length, 1, said.join('\n'));
  });

  it('warns under a styled base component, whose sheet is all it can read yet', async () => {
    const { said, mod } = await compiled(true);
    assert.equal((mod['Kid'] as { sheet: unknown }).sheet, mod['parent']);
    assert.ok(mod['kid'], 'its own sheet is there after the class');
    assert.notEqual(mod['kid'], mod['parent']);
    const about = said.filter((message) => message.includes('styleSheetOf(Kid)'));
    assert.equal(about.length, 1, said.join('\n'));
  });

  it('says nothing for a read after the class, or for a class with no sheet to read', async () => {
    const { said, mod } = await compiled(true);
    assert.ok(mod['later'], 'the sheet is there after the class');
    assert.equal(mod['plain'], null);
    assert.equal(mod['directive'], null);
    assert.equal(mod['undecorated'], null);
    assert.equal(mod['pipe'], null);
    assert.equal((mod['NoStyles'] as { sheet: unknown }).sheet, null);
    assert.equal((mod['StaticDirective'] as { sheet: unknown }).sheet, null);
    assert.deepEqual(
      said.filter(
        (message) =>
          !message.includes('styleSheetOf(A)') &&
          !message.includes('styleSheetOf(Child)') &&
          !message.includes('styleSheetOf(Kid)'),
      ),
      [],
    );
  });

  it('reads the sheet a renderer draws an undecorated subclass with, in any build', async () => {
    for (const dev of [true, false]) {
      const { said, mod } = await compiled(dev);
      assert.ok(mod['parent']);
      assert.equal(mod['underStyled'], mod['parent']);
      assert.equal((mod['StaticUnderStyled'] as { sheet: unknown }).sheet, mod['parent']);
      assert.ok(!said.some((message) => message.includes('UnderStyled')), said.join('\n'));
    }
  });

  it('says nothing for a class that has its sheet before its definition', async () => {
    const sheet = { rules: [] };
    let read: unknown;
    const said = await warnings(true, async () => {
      class Early {
        static ɵnativeStyles = sheet;
        static read = styleSheetOf(Early);
        static ɵcmp = {};
      }
      read = Early.read;
      await Promise.resolve();
    });
    assert.equal(read, sheet);
    assert.deepEqual(said, []);
  });

  it('says nothing in a release build', async () => {
    assert.deepEqual((await compiled(false)).said, []);
    assert.deepEqual((await compiled(undefined)).said, []);
  });
});

describe('styleSheetOf() on what is no class', () => {
  it('says nothing', async () => {
    const said = await warnings(true, () => {
      styleSheetOf(undefined);
      styleSheetOf(null);
      styleSheetOf({});
    });
    assert.deepEqual(said, []);
  });
});

async function root(): Promise<Type<unknown>> {
  const name = 'missing-style-sheet-root';
  const mod = await compileSource(ROOT, fixture(`${name}.ts`), fixture(`${name}.generated.ts`));
  return mod['Root'] as Type<unknown>;
}

/** Mounts and takes the app down again; the warning is said while mounting. */
function mounted(Root: Type<unknown>, options: Parameters<typeof mount>[3]): void {
  mount(1, Root, createFakeFabric(), options).applicationRef.destroy();
}

// The quiet cases first: the warning is said once per process, so a case after it could not show
// a stray one.
describe('mount() with globalStyles left out or a sheet given', () => {
  it('says nothing about it', async () => {
    const Root = await root();
    const said = await warnings(true, () => {
      mounted(Root, {});
      mounted(Root, { globalStyles: undefined });
      mounted(Root, { globalStyles: { rules: [] } });
    });
    assert.deepEqual(
      said.filter((message) => message.includes('globalStyles')),
      [],
    );
  });
});

describe('mount() given globalStyles: null', () => {
  it('says nothing in a release build', async () => {
    const Root = await root();
    assert.deepEqual(await warnings(false, () => mounted(Root, { globalStyles: null })), []);
    assert.deepEqual(await warnings(undefined, () => mounted(Root, { globalStyles: null })), []);
  });

  it('warns once in development', async () => {
    const Root = await root();
    const said = await warnings(true, () => {
      mounted(Root, { globalStyles: null });
      mounted(Root, { globalStyles: null });
    });
    const about = said.filter((message) => message.includes('globalStyles: null'));
    assert.equal(about.length, 1, said.join('\n'));
  });
});

describe('loadFonts() given a null sheet', () => {
  it('says nothing in a release build, or for a sheet or undefined', async () => {
    assert.deepEqual(await warnings(false, () => loadFonts(null)), []);
    assert.deepEqual(await warnings(undefined, () => loadFonts(null)), []);
    assert.deepEqual(await warnings(true, () => loadFonts({}, undefined)), []);
  });

  it('warns once in development', async () => {
    const said = await warnings(true, async () => {
      await loadFonts({}, null);
      await loadFonts(null);
    });
    assert.equal(said.length, 1, said.join('\n'));
    assert.match(said[0]!, /loadFonts\(\) was given a null sheet/);
  });
});
