/**
 * Angular HMR over Metro: a template edit hot-swaps on a live component, anything else reloads,
 * and the reload hook that fallback calls is installed by mounting.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Injector, type Type } from '@angular/core';
import { cleanup, render, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture, compileSource } from './compile.ts';
import { DevMenu, type DevMenuSource } from '@ng-native/device';
import { serviceWith } from './injected.ts';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('Angular HMR', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  afterEach(cleanup);

  /** Compile the same logical file twice, as Metro would across an edit. */
  const evaluate = (source: string, filename: string, out: string) =>
    compileSource(source, filename, out, { dev: true });

  it('swaps a template on a live component without losing state', async () => {
    const filename = fixture('counter.ts');
    const source = readFileSync(filename, 'utf8');

    const first = await evaluate(source, filename, fixture('counter.hmr-a.generated.ts'));
    const { fabric, instance } = await render<{ inc(): void; count(): number }>(
      first['Counter'] as Type<{ inc(): void; count(): number }>,
    );

    instance.inc();
    instance.inc();
    await settle();
    assert.match(fabric.render(), /RawText "count is 2"/, 'state built up before the edit');

    // The edit: template only, class body untouched.
    const edited = source.replace('count is', 'HOT count is').replace('>tap<', '>tapped<');
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args[0]);
    try {
      await evaluate(edited, filename, fixture('counter.hmr-b.generated.ts'));
      await settle();
    } finally {
      console.warn = warn;
    }
    // Re-running the file defines the class a second time with the same id, which Angular reports
    // as a collision on every save. It is the same component, so nothing should be said. (The
    // components it imports are re-evaluated here too, which Metro does not do, so only this
    // file's own is asserted on.)
    assert.deepEqual(
      warnings.filter((w) => String(w).includes('NG0912') && String(w).includes("'Counter'")),
      [],
    );

    assert.match(fabric.render(), /RawText "HOT count is 2"/, 'new template, old state');
    assert.match(fabric.render(), /RawText "tapped"/);
    assert.equal(instance.count(), 2, 'the component instance survived the swap');
  });

  it('compiles a component whose path has an @ in it, as a scoped package in node_modules does', async () => {
    // The HMR compiler reads the class name back out of a `path@ClassName` id by the first `@`,
    // so `node_modules/@ng-native/...` came out as a function named after the path: a syntax
    // error on the first dev bundle of every app installed from the registry.
    const filename = fixture('counter.ts');
    const scoped = filename.replace('/fixtures/', '/fixtures/node_modules/@scope/');
    const module = await evaluate(
      readFileSync(filename, 'utf8'),
      scoped,
      fixture('counter.scoped.generated.ts'),
    );

    assert.equal(typeof module['Counter'], 'function');
  });

  /** A component written in place, as `file`, with the given decorator metadata. */
  const inline = (metadata: string) => `import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({ imports: [Text, View], selector: 'x-inline', ${metadata} })
export class Inline {
  count = signal(0);
  inc(): void {
    this.count.update((c) => c + 1);
  }
}
`;

  async function liveInline(source: string, name: string) {
    const filename = fixture(`${name}.ts`);
    const mod = await evaluate(source, filename, fixture(`${name}.hmr-a.generated.ts`));
    const { fabric, instance } = await render<{ inc(): void; count(): number }>(
      mod['Inline'] as Type<{ inc(): void; count(): number }>,
    );
    instance.inc();
    await settle();
    const reloads: unknown[] = [];
    (globalThis as Record<string, unknown>)['__angularNativeReload'] = (id: unknown) =>
      reloads.push(id);
    const edit = async (edited: string) => {
      await evaluate(edited, filename, fixture(`${name}.hmr-b.generated.ts`));
      await settle();
      delete (globalThis as Record<string, unknown>)['__angularNativeReload'];
    };
    return { fabric, instance, reloads, edit };
  }

  it('swaps a quoted template with an escape in it, rather than reloading', async () => {
    // The template is stripped from the file to tell a template edit from any other, and that
    // looked for the template's text as written. An escaped quote is not written the way it
    // reads, so the template stayed in and every edit to it reloaded the app.
    const source = inline(String.raw`template: '<view><text>it\'s {{ count() }}</text></view>'`);
    const { fabric, instance, reloads, edit } = await liveInline(source, 'quoted-template');
    assert.match(fabric.render(), /RawText "it's 1"/);

    await edit(source.replace('it', 'now it'));

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.match(fabric.render(), /RawText "now it's 1"/, 'new template, old state');
    assert.equal(instance.count(), 1);
  });

  it('swaps inline styles on a live component without losing state', async () => {
    // An external stylesheet already hot-swaps. The same rule written in the component's own
    // styles reloaded the app, and the state went with it.
    const source = inline(
      'template: `<view class="box"><text>count {{ count() }}</text></view>`, ' +
        'styles: `.box { background-color: rgb(1, 1, 1); }`',
    );
    const { fabric, instance, reloads, edit } = await liveInline(source, 'inline-styles');
    const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const backgrounds = () =>
      flatten(fabric.committed)
        .map((node) => node.props['backgroundColor'])
        .filter((colour) => colour !== undefined);
    assert.deepEqual(backgrounds(), ['rgb(1, 1, 1)']);

    await edit(source.replace('rgb(1, 1, 1)', 'rgb(9, 9, 9)'));

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.deepEqual(backgrounds(), ['rgb(9, 9, 9)'], 'the new rule applied');
    assert.match(fabric.render(), /RawText "count 1"/, 'with the state it had');
    assert.equal(instance.count(), 1);
  });

  it("swaps a component's :host rule as well as its inner rules", async () => {
    // The host element is the parent's, and is not recreated by the swap, so its style had to be
    // worked out again for the new sheet: the inner rule changed and the :host rule did not.
    const source =
      inline(
        'template: `<view class="box"><text>count {{ count() }}</text></view>`, ' +
          'styles: `:host { background-color: rgb(1, 1, 1); } .box { background-color: rgb(2, 2, 2); }`',
      ) +
      `
@Component({ imports: [Inline], selector: 'x-outer', template: '<x-inline /><x-inline />' })
export class Outer {}
`;
    const filename = fixture('host-styles.ts');
    const mod = await evaluate(source, filename, fixture('host-styles.hmr-a.generated.ts'));
    const { fabric } = await render(mod['Outer'] as Type<unknown>);
    const reloads: unknown[] = [];
    (globalThis as Record<string, unknown>)['__angularNativeReload'] = (id: unknown) =>
      reloads.push(id);
    const edit = async (edited: string) => {
      await evaluate(edited, filename, fixture('host-styles.hmr-b.generated.ts'));
      await settle();
      delete (globalThis as Record<string, unknown>)['__angularNativeReload'];
    };
    const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const backgrounds = () =>
      flatten(fabric.committed)
        .map((node) => node.props['backgroundColor'])
        .filter((colour) => colour !== undefined);
    assert.deepEqual(backgrounds(), [
      'rgb(1, 1, 1)',
      'rgb(2, 2, 2)',
      'rgb(1, 1, 1)',
      'rgb(2, 2, 2)',
    ]);

    await edit(
      source.replace('rgb(1, 1, 1)', 'rgb(3, 3, 3)').replace('rgb(2, 2, 2)', 'rgb(4, 4, 4)'),
    );

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.deepEqual(backgrounds(), [
      'rgb(3, 3, 3)',
      'rgb(4, 4, 4)',
      'rgb(3, 3, 3)',
      'rgb(4, 4, 4)',
    ]);
  });

  it('swaps a template that gained elements and bindings, and keeps rendering after', async () => {
    // The compiler's update function spread the old definition and replaced only the template,
    // so the view was rebuilt with the slot and binding counts of the template before the edit.
    // One more element at the top level of the template, as an edit to the Run screen in
    // examples/runs had, and the new instructions ran off the end of a view sized for the old
    // one: an assertion halfway through the swap (which one depends on where the new slots land -
    // "Expecting LContainer", "LContainer must be defined", "TNodes should be created before any
    // bindings"), and a half-built view left in the tree that threw on every change detection.
    const source = inline(
      'template: `<view>@if (count() > 0) {<text>on</text>}<text>n {{ count() }}</text></view>`',
    );
    const { fabric, instance, reloads, edit } = await liveInline(source, 'grown-template');
    assert.match(fabric.render(), /RawText "n 1"/);

    await edit(
      source.replace(
        '<text>n {{ count() }}</text>',
        '<text>above</text><text>n {{ count() }} of {{ count() + 1 }}</text>' +
          '@if (count() > 0) {<text>below</text>}<ng-content />',
      ),
    );

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.match(fabric.render(), /RawText "above"/, 'the new template');
    assert.match(fabric.render(), /RawText "n 1 of 2"/, 'with the state it had');
    assert.match(fabric.render(), /RawText "below"/);
    const def = (instance.constructor as unknown as { ɵcmp: { ngContentSelectors?: string[] } })
      .ɵcmp;
    assert.deepEqual(def.ngContentSelectors, ['*'], 'and the slots it projects into');

    instance.inc();
    await settle();
    assert.match(fabric.render(), /RawText "n 2 of 3"/, 'and it still updates after the swap');
  });

  it('asks for a reload when a swap throws, rather than leaving a broken view', async () => {
    // Whatever goes wrong inside the swap, the view it was rebuilding is already half in the tree
    // and throws on every change detection after. A reload is the only way back to a live screen.
    const source = inline('template: `<view><text>n {{ count() }}</text></view>`');
    const { fabric, reloads, edit } = await liveInline(source, 'throwing-template');
    assert.match(fabric.render(), /RawText "n 1"/);

    const error = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await edit(source.replace('{{ count() }}', '{{ $any(count()).not.there }}'));
    } finally {
      console.error = error;
    }

    assert.equal(reloads.length, 1, 'fell back to a reload');
    assert.ok(errors.length > 0, 'and said why');
  });

  it('patches an edited method onto a live component without losing state', async () => {
    // A handler's body is the edit made most often after a template, and it reloaded the app:
    // the state went, and the route with it.
    const source = inline('template: `<view><text>n {{ count() }}</text></view>`');
    const { fabric, instance, reloads, edit } = await liveInline(source, 'method-edit');

    await edit(source.replace('c + 1', 'c + 10').replace('<text>n ', '<text>now '));

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.equal(instance.count(), 1, 'the component instance survived, with its state');
    assert.match(fabric.render(), /RawText "now 1"/, 'a template edit in the same save landed');
    instance.inc();
    await settle();
    assert.match(fabric.render(), /RawText "now 11"/, 'and the instance runs the edited method');
  });

  it('builds a component made after a patch from the edited file', async () => {
    // The live class is the one every other module holds, so it is what makes the next instance:
    // with the constructor of the class the file defines now, which reads the file as it is now.
    const filename = fixture('patched-constructor.ts');
    const source = inline('template: `<view><text>n {{ count() }}</text></view>`')
      .replace('@Component', 'function start() {\n  return 0;\n}\n\n@Component')
      .replace('signal(0)', 'signal(start())');
    const first = await evaluate(
      source,
      filename,
      fixture('patched-constructor.hmr-a.generated.ts'),
    );
    const type = first['Inline'] as Type<{ inc(): void; count(): number }>;
    const before = await render(type);
    const reloads: unknown[] = [];
    (globalThis as Record<string, unknown>)['__angularNativeReload'] = (id: unknown) =>
      reloads.push(id);

    try {
      await evaluate(
        source.replace('return 0', 'return 5').replace('c + 1', 'c + 10'),
        filename,
        fixture('patched-constructor.hmr-b.generated.ts'),
      );
      await settle();
    } finally {
      delete (globalThis as Record<string, unknown>)['__angularNativeReload'];
    }
    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.equal(before.instance.count(), 0, 'a live instance keeps the state it has');

    const { fabric, instance } = await render(type);
    assert.equal(instance.count(), 5, 'a new one is built by the file as edited');
    assert.ok(instance instanceof type, 'and is an instance of the class other modules hold');
    instance.inc();
    await settle();
    assert.match(fabric.render(), /RawText "n 15"/);
  });

  it('asks for a reload when a field or the constructor changed, which no live instance ran', async () => {
    // An initialiser runs when an instance is made. Patched, the edit would reach the components
    // made after it and none of the ones on screen, which reads as an edit that did nothing.
    const source = inline('template: `<view><text>n {{ count() }}</text></view>`');
    const edits = [
      source.replace('signal(0)', 'signal(5)'),
      source.replace('count = signal(0);', "count = signal(0);\n  label = signal('x');"),
      source.replace('inc(): void', 'constructor() {\n    this.count.set(3);\n  }\n  inc(): void'),
    ];
    for (const [index, edited] of edits.entries()) {
      const error = console.error;
      const errors: unknown[] = [];
      console.error = (...args: unknown[]) => void errors.push(args);
      try {
        const { instance, reloads, edit } = await liveInline(source, `built-edit-${index}`);
        await edit(edited);
        assert.equal(reloads.length, 1, `edit ${index} fell back to a reload`);
        assert.equal(instance.count(), 1, 'with nothing patched first');
        assert.deepEqual(errors, [], 'and nothing half-applied to report');
      } finally {
        console.error = error;
      }
      await cleanup();
    }
  });

  it('asks for a reload when the selector or an input changed, which other templates have read', async () => {
    // A template that uses the component matched it by selector and bound its inputs when it was
    // first rendered, and a patch to this class does not render that template again.
    const source = inline('template: `<view><text>n {{ count() }}</text></view>`');
    const { reloads, edit } = await liveInline(source, 'selector-edit');

    await edit(source.replace("selector: 'x-inline'", "selector: 'x-renamed'"));

    assert.equal(reloads.length, 1, 'fell back to a reload');
  });

  it('asks for a reload when the file exports more than its components', async () => {
    // Every module that imports the file keeps the exports it already read. A class can be
    // patched where it is; a constant cannot, so the edit would reach this file and no other.
    const source =
      inline('template: `<view><text>n {{ count() }}</text></view>`') + 'export const LIMIT = 3;\n';
    const { reloads, edit } = await liveInline(source, 'other-export');

    await edit(source.replace('LIMIT = 3', 'LIMIT = 4'));

    assert.equal(reloads.length, 1, 'fell back to a reload rather than patching half of it');
  });
});

/**
 * A service and a directive are patched the way a component's class is: the class every other
 * module holds takes the edited members, and the instances already made keep their state.
 */
describe('Angular HMR, for a class that is not a component', () => {
  const scope = globalThis as Record<string, unknown>;
  let reloads: unknown[] = [];
  beforeEach(() => {
    reloads = [];
    scope['__angularNativeReload'] = (id: unknown) => reloads.push(id);
  });
  afterEach(() => delete scope['__angularNativeReload']);

  const evaluate = (source: string, name: string, pass: string) =>
    compileSource(source, fixture(`${name}.ts`), fixture(`${name}.hmr-${pass}.generated.ts`), {
      dev: true,
    });

  const service = `import { Injectable, signal } from '@angular/core';

function start() {
  return 0;
}

@Injectable({ providedIn: 'root' })
export class Tally {
  total = signal(start());
  add(): void {
    this.total.update((t) => t + 1);
  }
}
`;
  interface Tally {
    add(): void;
    total(): number;
  }

  it('patches an edited service, keeping the instance an app already injected', async () => {
    const first = await evaluate(service, 'hmr-tally', 'a');
    const type = first['Tally'] as Type<Tally> & { ɵprov: { factory(): Tally } };
    const live = Injector.create({ providers: [type] }).get(type);
    live.add();

    await evaluate(
      service.replace('t + 1', 't + 10').replace('return 0', 'return 5'),
      'hmr-tally',
      'b',
    );

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    live.add();
    assert.equal(live.total(), 11, 'the live instance kept its state and runs the edited method');
    const made = Injector.create({ providers: [type] }).get(type);
    assert.equal(made.total(), 5, 'one made after the edit is built by the file as edited');
    assert.ok(made instanceof type);
    assert.equal(type.ɵprov.factory().total(), 5, 'as does one the root injector has yet to make');
  });

  it('asks for a reload when a service field changed, which the instance in use never ran', async () => {
    await evaluate(service, 'hmr-tally-field', 'a');

    await evaluate(
      service.replace('signal(start())', 'signal(start() + 1)'),
      'hmr-tally-field',
      'b',
    );

    assert.equal(reloads.length, 1);
  });

  it('asks for a reload when a service file exports a token as well', async () => {
    const source = service + 'export const LIMIT = 3;\n';
    await evaluate(source, 'hmr-tally-token', 'a');

    await evaluate(source.replace('LIMIT = 3', 'LIMIT = 4'), 'hmr-tally-token', 'b');

    assert.equal(reloads.length, 1);
  });

  const directive = `import { Directive } from '@angular/core';

@Directive({ selector: '[xMark]', host: { '[style.opacity]': 'level()' } })
export class Mark {
  level(): number {
    return 1;
  }
}
`;

  it('patches an edited directive method', async () => {
    const first = await evaluate(directive, 'hmr-mark', 'a');
    const type = first['Mark'] as new () => { level(): number };
    const live = new type();

    await evaluate(directive.replace('return 1', 'return 2'), 'hmr-mark', 'b');

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.equal(live.level(), 2);
  });

  it("asks for a reload when a directive's host bindings changed, which no view reads again", async () => {
    await evaluate(directive, 'hmr-mark-host', 'a');

    await evaluate(directive.replace("'level()'", "'level() / 2'"), 'hmr-mark-host', 'b');

    assert.equal(reloads.length, 1);
  });
});

/**
 * What a patch has to leave true of the app: one class by each name whoever asks, the edit on
 * screen, and nothing patched that the running app has already read.
 */
describe('Angular HMR, across a file and the modules that import it', () => {
  const scope = globalThis as Record<string, unknown>;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  let reloads: unknown[] = [];
  beforeEach(() => {
    reloads = [];
    scope['__angularNativeReload'] = (id: unknown) => reloads.push(id);
    // Development, as an app being edited is: `mount` installs what makes a patch show.
    scope['__DEV__'] = true;
  });
  afterEach(async () => {
    delete scope['__angularNativeReload'];
    delete scope['__angularNativeHot'];
    delete scope['__DEV__'];
    delete scope['module'];
    await cleanup();
  });

  const evaluate = (source: string, name: string, pass: string) =>
    compileSource(source, fixture(`${name}.ts`), fixture(`${name}.hmr-${pass}.generated.ts`), {
      dev: true,
    });

  /**
   * Metro's module object for one run of a file, with exports as it defines them: a getter nothing
   * can write to for each binding in `names`, read from `bindings` as the app reads it, later. A
   * function declaration is assigned instead, which the file does for itself in an app.
   */
  const metroModule = (
    bindings: () => Record<string, unknown> = () => ({}),
    names: string[] = [],
  ) => {
    const exports: Record<string, unknown> = {};
    for (const name of names) {
      Object.defineProperty(exports, name, { enumerable: true, get: () => bindings()[name] });
    }
    const module = { exports, hot: { accept() {} } };
    scope['module'] = module;
    return module;
  };

  const family = `import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({ imports: [Text], selector: 'x-child', template: '<text>child {{ label() }}</text>' })
export class Child {
  label(): string {
    return 'a';
  }
}

@Component({ imports: [Child, View], selector: 'x-parent', template: '<view><x-child /></view>' })
export class Parent {}
`;

  it('renders a component in the same file from its live class, and exports that class', async () => {
    // The file's own code names the class its latest run defined. Rendered from that, the child
    // would belong to a class no other module holds and no later edit reaches.
    const first = await evaluate(family, 'hmr-family', 'a');
    const { fabric } = await render(first['Parent'] as Type<unknown>);

    // The parent's template is edited as well, so its definition is the one this run compiled.
    const edited = family
      .replace("return 'a'", "return 'b'")
      .replace('<view><x-child />', '<view><x-child /><x-child />');
    const second = await evaluate(edited, 'hmr-family', 'b');
    await settle();

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.match(fabric.render(), /RawText "child b"[\s\S]*RawText "child b"/);
    assert.equal(second['Child'], first['Child'], 'the file exports the class everyone holds');
    const parent = first['Parent'] as unknown as {
      ɵcmp: { directiveDefs(): { type: unknown; selectors: string[][] }[] };
    };
    const children = parent.ɵcmp
      .directiveDefs()
      .filter((def) => def.selectors[0]![0] === 'x-child');
    assert.deepEqual(
      children.map((def) => def.type),
      [first['Child']],
    );
  });

  it('makes no view again for an edited method, nor for the component beside it', async () => {
    // A view made again loses everything in it: the state of each component, and a stack of
    // screens when it is the shell a page sits in. Here, the child the parent renders.
    const source = family
      .replace(
        'label(): string {',
        'made = ++(globalThis as unknown as { hmrChildren: number }).hmrChildren;\n  label(): string {',
      )
      .replace(
        "template: '<view><x-child /></view>' })\nexport class Parent {}",
        "template: '<view><text>{{ title() }}</text><x-child /></view>' })\nexport class Parent {\n  title(): string {\n    return 'p';\n  }\n}",
      )
      .replace('imports: [Child, View]', 'imports: [Child, Text, View]');
    const counts = globalThis as unknown as { hmrChildren?: number };
    counts.hmrChildren = 0;
    try {
      const first = await evaluate(source, 'hmr-beside', 'a');
      const { fabric } = await render(first['Parent'] as Type<unknown>);

      await evaluate(source.replace("return 'p'", "return 'q'"), 'hmr-beside', 'b');
      await settle();

      assert.deepEqual(reloads, [], 'nothing asked for a reload');
      assert.match(fabric.render(), /RawText "q"/, 'the edited method is on screen');
      assert.equal(counts.hmrChildren, 1, 'in the views that were there');
    } finally {
      delete counts.hmrChildren;
    }
  });

  it('asks for a reload when the edited component hosts an outlet, whose screens it would lose', async () => {
    const shell = (extra: string) => `import { Component } from '@angular/core';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  imports: [NativeStackOutlet],
  selector: 'x-shell',
  template: '<native-stack-outlet${extra} />',
})
export class Shell {
  title(): string {
    return 'a';
  }
}
`;
    await evaluate(shell(''), 'hmr-shell', 'a');
    await evaluate(shell(' class="wide"'), 'hmr-shell', 'b');
    assert.equal(reloads.length, 1, 'for its template');

    await evaluate(shell('').replace('x-shell', 'x-shell-two'), 'hmr-shell-method', 'a');
    await evaluate(
      shell('').replace('x-shell', 'x-shell-two').replace("return 'a'", "return 'b'"),
      'hmr-shell-method',
      'b',
    );
    assert.equal(reloads.length, 1, 'and not for a method, which renders nothing again');
  });

  it("patches a page that is its file's default export, as a file route's is", async () => {
    const source = `import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';

@Component({ imports: [Text], selector: 'x-page', template: '<text>page {{ label() }}</text>' })
export default class Page {
  label(): string {
    return 'a';
  }
}
`;
    const first = await evaluate(source, 'hmr-default', 'a');
    const { fabric } = await render(first['default'] as Type<unknown>);

    const second = await evaluate(source.replace("return 'a'", "return 'b'"), 'hmr-default', 'b');
    await settle();

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.match(fabric.render(), /RawText "page b"/);
    assert.equal(second['default'], first['default'], 'and exports the class the router holds');
  });

  it('carries no hot update in a release build, on the web, or for a file that was installed', () => {
    const { transformAngular } = createRequire(import.meta.url)(
      '@ng-native/metro/angular-transform.cjs',
    );
    const code = (file: string, options: object) => transformAngular(plain, file, options).code;
    assert.notEqual(code('/app/src/sums.ts', { dev: true }), plain, 'an app module in development');
    assert.equal(code('/app/src/sums.ts', { dev: false }), plain);
    assert.equal(code('/app/src/sums.ts', { dev: true, platform: 'web' }), plain);
    assert.equal(code('/app/node_modules/sums/index.ts', { dev: true }), plain);
    assert.equal(code('/app/src/sums.d.ts', { dev: true }), plain);
  });

  it('applies an update once when Metro sends it twice, and reloads for a dependency', async (t) => {
    // Metro sends an edit once for each bundle the file is in, so a file two lazy routes share
    // runs twice for one save. The second run has the source the first applied, which is also
    // how a dependency's edit looks: that one comes later, or after its own module ran.
    t.mock.timers.enable({ apis: ['Date'] });
    const edited = family.replace("return 'a'", "return 'b'");
    const first = await evaluate(family, 'hmr-twice', 'a');
    const { fabric } = await render(first['Parent'] as Type<unknown>);

    await evaluate(edited, 'hmr-twice', 'b');
    await evaluate(edited, 'hmr-twice', 'c');
    await settle();
    assert.deepEqual(reloads, [], 'the second time is nothing to reload for');
    assert.match(fabric.render(), /RawText "child b"/);

    // A module with no update of its own ran in between: a table of constants this file imports.
    await evaluate('export const TABLE = [1];\n', 'hmr-twice-table', 'a');
    await evaluate(edited, 'hmr-twice', 'd');
    assert.equal(reloads.length, 1, 'a dependency ran again');

    await evaluate(edited + '\n', 'hmr-twice', 'e');
    t.mock.timers.tick(3000);
    await evaluate(edited + '\n', 'hmr-twice', 'f');
    assert.equal(reloads.length, 2, 'and so is a run that comes later');
  });

  it('asks for a reload when a decorator provides a class of the same file', async () => {
    // The definition holds the class this run defined in its providers, which is not the one
    // the rest of the app injects by.
    const source = family
      .replace('import { Component }', 'import { Component, Injectable }')
      .replace(
        '@Component({ imports: [Child, View]',
        '@Injectable()\nexport class Store {\n  n(): number {\n    return 1;\n  }\n}\n\n@Component({ providers: [Store], imports: [Child, View]',
      );
    await evaluate(source, 'hmr-provided', 'a');

    await evaluate(source.replace('return 1', 'return 2'), 'hmr-provided', 'b');

    assert.equal(reloads.length, 1);
  });

  const mixed = `import { Injectable } from '@angular/core';

export function double(n: number): number {
  return n * 2;
}

export const LIMIT = 3;

@Injectable({ providedIn: 'root' })
export class Sums {
  twice(n: number): number {
    return double(n);
  }
}
`;

  it('hands an edited function to the modules that call it, beside a class', async () => {
    // A module calls an import through the exports it was handed when it loaded, so that is
    // where the edited function goes, and what the file goes on exporting.
    let first: Record<string, unknown> = {};
    const run = metroModule(() => first, ['LIMIT', 'Sums']);
    first = await evaluate(mixed, 'hmr-mixed', 'a');
    const held = run.exports;
    // What a component does with an import its template calls: keeps the function in a field.
    const kept = held['double'] as (n: number) => number;
    assert.equal(kept(2), 4);

    let second: Record<string, unknown> = {};
    const rerun = metroModule(() => second, ['LIMIT', 'Sums']);
    second = await evaluate(mixed.replace('n * 2', 'n * 3'), 'hmr-mixed', 'b');

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.equal((held['double'] as (n: number) => number)(2), 6);
    assert.equal(kept(2), 6, 'a function kept from before the edit runs the edited one');
    assert.equal(held['Sums'], first['Sums'], 'the class is still the one they hold');
    assert.equal(held['LIMIT'], 3, 'and the constant the one they read');
    assert.deepEqual(Object.keys(held).sort(), ['LIMIT', 'Sums', 'double']);
    assert.equal(rerun.exports, held, 'and a module that imports the file now is handed the same');
  });

  it('asks for a reload when a constant beside a class changed, which its importers have read', async () => {
    await evaluate(mixed, 'hmr-mixed-constant', 'a');

    await evaluate(mixed.replace('LIMIT = 3', 'LIMIT = 4'), 'hmr-mixed-constant', 'b');

    assert.equal(reloads.length, 1);
  });

  const plain = `export function double(n: number): number {
  return n * 2;
}

export const LIMIT = 3;
`;

  it('hands an edited function on from a module with no class in it', async () => {
    const run = metroModule();
    await evaluate(plain, 'hmr-plain', 'a');
    const held = run.exports;

    metroModule();
    await evaluate(plain.replace('n * 2', 'n * 3'), 'hmr-plain', 'b');

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.equal((held['double'] as (n: number) => number)(2), 6);

    await evaluate(
      plain.replace('n * 2', 'n * 3').replace('LIMIT = 3', 'LIMIT = 4'),
      'hmr-plain',
      'c',
    );
    assert.equal(reloads.length, 1, 'and reloads for its constant');
  });

  it('hands on a function that shares its name with a key the module loads', async () => {
    // A table with a `double` column is not a call to `double`.
    const source = plain + 'export const TABLE = [{ double: 1 }, { double: TABLE_SIZE.double }];\n';
    const table = source.replace(
      'export const LIMIT',
      'const TABLE_SIZE = { double: 2 };\nexport const LIMIT',
    );
    const run = metroModule();
    await evaluate(table, 'hmr-plain-key', 'a');
    const held = run.exports;

    metroModule();
    await evaluate(table.replace('n * 2', 'n * 3'), 'hmr-plain-key', 'b');

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.equal((held['double'] as (n: number) => number)(2), 6);
  });

  it('asks for a reload when the module called the edited function as it loaded', async () => {
    // `FOUR` was worked out by the function from before the edit, and read by whoever imports it.
    const source = plain + 'export const FOUR = double(2);\n';
    await evaluate(source, 'hmr-plain-called', 'a');

    await evaluate(source.replace('n * 2', 'n * 3'), 'hmr-plain-called', 'b');

    assert.equal(reloads.length, 1);
  });

  const derived = `import { Component, computed, effect, inject, Injectable } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

export function shout(word: string): string {
  return word + '!';
}

@Injectable({ providedIn: 'root' })
export class Words {
  first(): string {
    return 'one';
  }
}

@Component({
  imports: [Text, View],
  selector: 'x-derived',
  template: '<view><text>{{ loud() }}</text><text>{{ word() }}</text></view>',
})
export class Derived {
  private readonly words = inject(Words);
  protected readonly loud = computed(() => shout('hey'));
  protected readonly word = computed(() => this.words.first());
  constructor() {
    effect(() => {
      this.words.first();
      (globalThis as unknown as { hmrEffects: number }).hmrEffects++;
    });
  }
  ngOnDestroy(): void {
    (globalThis as unknown as { hmrDestroyed: string }).hmrDestroyed = 'old';
  }
}
`;

  it('works a computed out again when a function or a method it called is edited', async () => {
    // Nothing a `computed` reads changes when the code it calls does, so it kept its answer and
    // the edit never reached the screen.
    const counts = globalThis as unknown as { hmrEffects?: number };
    counts.hmrEffects = 0;
    try {
      const first = await evaluate(derived, 'hmr-derived', 'a');
      const { fabric } = await render(first['Derived'] as Type<unknown>);
      await settle();
      assert.match(fabric.render(), /RawText "hey!"[\s\S]*RawText "one"/);
      const ran = counts.hmrEffects;

      await evaluate(
        derived.replace("word + '!'", "word + '?'").replace("return 'one'", "return 'two'"),
        'hmr-derived',
        'b',
      );
      await settle();

      assert.deepEqual(reloads, [], 'nothing asked for a reload');
      assert.match(fabric.render(), /RawText "hey\?"[\s\S]*RawText "two"/);
      assert.equal(counts.hmrEffects, ran, 'an effect that called the method does not run again');
    } finally {
      delete counts.hmrEffects;
    }
  });

  it('asks for a reload when a class keeps a constant function it built an instance with', async () => {
    // A constant's binding cannot be handed the function that stays, so the closure the live
    // instance made holds the one from before the edit, and nothing would bring the new one.
    const counts = globalThis as unknown as { hmrEffects?: number };
    counts.hmrEffects = 0;
    const source = derived.replace(
      "export function shout(word: string): string {\n  return word + '!';\n}",
      "const shout = (word: string): string => word + '!';",
    );
    try {
      await evaluate(source, 'hmr-derived-constant', 'a');

      await evaluate(source.replace("word + '!'", "word + '?'"), 'hmr-derived-constant', 'b');

      assert.equal(reloads.length, 1);
    } finally {
      delete counts.hmrEffects;
    }
  });

  it('asks for a reload when a decorator holds an edited function of the file', async () => {
    const counts = globalThis as unknown as { hmrEffects?: number };
    counts.hmrEffects = 0;
    const source = derived.replace(
      "selector: 'x-derived',",
      "selector: 'x-derived',\n  providers: [{ provide: 'word', useFactory: shout }],",
    );
    try {
      await evaluate(source, 'hmr-derived-factory', 'a');

      await evaluate(source.replace("word + '!'", "word + '?'"), 'hmr-derived-factory', 'b');

      assert.equal(reloads.length, 1);
    } finally {
      delete counts.hmrEffects;
    }
  });

  it('runs an edited lifecycle hook, which Angular holds as the function it first found', async () => {
    const seen = globalThis as unknown as { hmrDestroyed?: string; hmrEffects?: number };
    seen.hmrEffects = 0;
    try {
      const first = await evaluate(derived, 'hmr-hook', 'a');
      await render(first['Derived'] as Type<unknown>);

      await evaluate(
        derived.replace("hmrDestroyed = 'old'", "hmrDestroyed = 'new'"),
        'hmr-hook',
        'b',
      );
      await cleanup();

      assert.deepEqual(reloads, [], 'nothing asked for a reload');
      assert.equal(seen.hmrDestroyed, 'new');
    } finally {
      delete seen.hmrDestroyed;
      delete seen.hmrEffects;
    }
  });

  it('asks for a reload when a lifecycle hook is added, which a live view would never call', async () => {
    const counts = globalThis as unknown as { hmrEffects?: number };
    counts.hmrEffects = 0;
    try {
      await evaluate(derived, 'hmr-hook-added', 'a');

      await evaluate(
        derived.replace('ngOnDestroy(): void {', 'ngOnInit(): void {}\n  ngOnDestroy(): void {'),
        'hmr-hook-added',
        'b',
      );

      assert.equal(reloads.length, 1);
    } finally {
      delete counts.hmrEffects;
    }
  });

  it('renders again a template that calls an edited service, with nothing touched', async () => {
    // The component did not change and no signal did, so nothing would have asked its template
    // again: the edit landed and the screen went on showing the old answer.
    const file = fixture('hmr-label.ts');
    const service = readFileSync(file, 'utf8');
    await compileSource(service, file, fixture('hmr-label.generated.ts'), { dev: true });
    const reader = `import { Component, inject } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { Label } from './hmr-label.ts';

@Component({ imports: [Text], selector: 'x-reader', template: '<text>says {{ label.text() }}</text>' })
export class Reader {
  label = inject(Label);
}
`;
    const mod = await evaluate(reader, 'hmr-reader', 'a');
    const { fabric } = await render(mod['Reader'] as Type<unknown>);
    assert.match(fabric.render(), /RawText "says one"/);

    await compileSource(
      service.replace("'one'", "'two'"),
      file,
      fixture('hmr-label.hmr-b.generated.ts'),
      {
        dev: true,
      },
    );
    await settle();

    assert.deepEqual(reloads, [], 'nothing asked for a reload');
    assert.match(fabric.render(), /RawText "says two"/);
  });
});

/**
 * The same swap, for a component whose template and stylesheet are files of their own.
 *
 * Metro re-transforms only the file that changed. An edit to `x.html` leaves the component's own
 * module cached with the old template compiled into it, and re-running that module - which is all
 * bubbling the update up to it can do - hands back the same code. So the resource's module carries
 * the update itself: the recompiled template and stylesheet of every component that uses it.
 */
describe('Angular HMR, with an external template and stylesheet', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const evaluate = (source: string, filename: string, out: string) =>
    compileSource(source, filename, out, { dev: true });
  const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const backgrounds = (fabric: FakeFabric) =>
    flatten(fabric.committed)
      .map((node) => node.props['backgroundColor'])
      .filter((colour) => colour !== undefined);

  const owner = fixture('external-counter.ts');
  const template = fixture('external-counter.html');
  const stylesheet = fixture('external-counter.css');
  const read = (file: string) => readFileSync(file, 'utf8');
  const scope = globalThis as Record<string, unknown>;

  let reloads: unknown[];
  beforeEach(() => {
    // Each test is a fresh app: nothing registered, nothing pending.
    delete scope['__angularNativeHmr'];
    delete scope['__angularNativeHmrPending'];
    reloads = [];
    scope['__angularNativeReload'] = (id: unknown) => reloads.push(id);
  });
  after(() => delete scope['__angularNativeReload']);
  afterEach(cleanup);

  /** Load the app as Metro orders it: the resources first, because the component imports them. */
  async function boot(tag: string) {
    await evaluate(read(template), template, fixture(`external-counter.html.${tag}.generated.ts`));
    await evaluate(
      read(stylesheet),
      stylesheet,
      fixture(`external-counter.css.${tag}.generated.ts`),
    );
    const mod = await evaluate(read(owner), owner, fixture(`external-counter.${tag}.generated.ts`));
    const { fabric, instance } = await render<{ inc(): void; count(): number }>(
      mod['ExternalCounter'] as Type<{ inc(): void; count(): number }>,
    );
    instance.inc();
    instance.inc();
    await settle();
    assert.match(fabric.render(), /RawText "count is 2"/, 'state built up before the edit');
    return { fabric, instance };
  }

  it('swaps an external template on a live component without losing state', async () => {
    const { fabric, instance } = await boot('html-a');

    const edited = read(template).replace('count is', 'HOT count is');
    await evaluate(edited, template, fixture('external-counter.html.html-b.generated.ts'));
    await settle();

    assert.match(fabric.render(), /RawText "HOT count is 2"/, 'new template, old state');
    assert.equal(instance.count(), 2, 'the component instance survived the swap');
    assert.deepEqual(reloads, [], 'and nothing asked for a reload');
  });

  it('swaps an external stylesheet on a live component without losing state', async () => {
    const { fabric, instance } = await boot('css-a');
    assert.deepEqual(backgrounds(fabric), ['rgb(1, 1, 1)'], 'the sheet applied before the edit');

    const edited = read(stylesheet).replace('rgb(1, 1, 1)', 'rgb(9, 9, 9)');
    await evaluate(edited, stylesheet, fixture('external-counter.css.css-b.generated.ts'));
    await settle();

    assert.deepEqual(backgrounds(fabric), ['rgb(9, 9, 9)'], 'the new rule reached the live view');
    assert.match(fabric.render(), /RawText "count is 2"/, 'with the state it had');
    assert.equal(instance.count(), 2);
    assert.deepEqual(reloads, []);
  });

  it('applies an edited template on a reload, when the component module is stale', async () => {
    // After a reload Metro serves the component's module from its cache, compiled against the
    // template as it was before the edit. The resource's own module is fresh, and runs first.
    const edited = read(template).replace('count is', 'RELOADED count is');
    await evaluate(edited, template, fixture('external-counter.html.stale-a.generated.ts'));
    const mod = await evaluate(
      read(owner),
      owner,
      fixture('external-counter.stale-a.generated.ts'),
    );

    const { fabric } = await render(mod['ExternalCounter'] as Type<unknown>);

    assert.match(fabric.render(), /RawText "RELOADED count is 0"/, 'the edit, not the cached copy');
  });

  it("keeps the component's own edit on a reload, when the stylesheet module is the stale one", async () => {
    // The other way round: the component was edited after its stylesheet last was, so Metro
    // re-transforms the component and serves the stylesheet's module from its cache, carrying the
    // component's template as it was then. Swapping that in would undo the edit on every load.
    await evaluate(
      read(stylesheet),
      stylesheet,
      fixture('external-counter.css.stale-b.generated.ts'),
    );
    const edited = read(owner).replace(
      "templateUrl: './external-counter.html',",
      "template: '<text>EDITED {{ count() }}</text>',",
    );
    assert.notEqual(edited, read(owner), 'the fixture still has the templateUrl this replaces');
    const mod = await evaluate(edited, owner, fixture('external-counter.stale-b.generated.ts'));

    const { fabric } = await render(mod['ExternalCounter'] as Type<unknown>);

    assert.match(fabric.render(), /RawText "EDITED 0"/, 'the component as it is now');
  });
});

describe('Angular HMR, on a cold start after a stylesheet edit', () => {
  const evaluate = (source: string, filename: string, out: string) =>
    compileSource(source, filename, out, { dev: true });
  const owner = fixture('hmr-switch-row.ts');
  const stylesheet = fixture('hmr-switch-row.css');
  const read = (file: string) => readFileSync(file, 'utf8');
  const scope = globalThis as Record<string, unknown>;

  beforeEach(() => {
    delete scope['__angularNativeHmr'];
    delete scope['__angularNativeHmrPending'];
  });
  afterEach(cleanup);

  it('leaves a custom form control one, with the edited sheet applied', async () => {
    // Metro re-transformed the stylesheet's module on the edit and serves the component's from its
    // cache, compiled against the sheet as it was. The stylesheet's module runs first and its
    // update is applied to the component before anything has rendered.
    const edited = read(stylesheet).replace('rgb(1, 1, 1)', 'rgb(9, 9, 9)');
    await evaluate(edited, stylesheet, fixture('hmr-switch-row.css.cold.generated.ts'));
    const mod = await evaluate(read(owner), owner, fixture('hmr-switch-row.cold.generated.ts'));

    const { fabric } = await render(mod['SwitchRowPage'] as Type<unknown>);

    assert.match(fabric.render(), /RawText "Open-ended on"/, 'the control took the field');
    const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const colours = flatten(fabric.committed).map((node) => node.props['color']);
    assert.ok(colours.includes('rgb(9, 9, 9)'), 'in the sheet as edited');
  });
});

describe('Angular HMR, with a stylesheet shared through a ../ path', () => {
  // Two screens in sibling directories use `styleUrl: '../lab.css'`. The stylesheet's module only
  // looked beside itself for the components using it, found none, and carried no update: the edit
  // bubbled to each screen's module, which Metro serves from its cache, so the app reloaded and
  // kept the old styles.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const evaluate = (source: string, filename: string, out: string) =>
    compileSource(source, filename, out, { dev: true });
  const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const backgrounds = (fabric: FakeFabric) =>
    flatten(fabric.committed)
      .map((node) => node.props['backgroundColor'])
      .filter((colour) => colour !== undefined);

  const sheet = fixture('shared-sheet/lab.css');
  const home = fixture('shared-sheet/home/home.ts');
  const settings = fixture('shared-sheet/settings/settings.ts');
  const read = (file: string) => readFileSync(file, 'utf8');
  const beside = (file: string, tag: string) => file.replace(/\.(ts|css)$/, `.${tag}.generated.ts`);
  const scope = globalThis as Record<string, unknown>;

  let reloads: unknown[];
  beforeEach(() => {
    delete scope['__angularNativeHmr'];
    delete scope['__angularNativeHmrPending'];
    reloads = [];
    scope['__angularNativeReload'] = (id: unknown) => reloads.push(id);
  });
  after(() => delete scope['__angularNativeReload']);
  afterEach(cleanup);

  it("carries the update for every component that reaches it with ../, in the sheet's module", () => {
    const { transformAngular } = createRequire(import.meta.url)(
      '@ng-native/metro/angular-transform.cjs',
    );
    const { code } = transformAngular(read(sheet), sheet, { dev: true });
    assert.ok(code.includes(JSON.stringify(`${home}@Home`)), 'found home, a directory down');
    assert.ok(code.includes(JSON.stringify(`${settings}@Settings`)), 'and settings beside it');
  });

  it('swaps the edited sheet on a live screen without losing state', async () => {
    await evaluate(read(sheet), sheet, beside(sheet, 'swap-a'));
    const mod = await evaluate(read(home), home, beside(home, 'swap-a'));
    const { fabric, instance } = await render<{ inc(): void; count(): number }>(
      mod['Home'] as Type<{ inc(): void; count(): number }>,
    );
    instance.inc();
    await settle();
    assert.deepEqual(backgrounds(fabric), ['rgb(1, 1, 1)'], 'the sheet applied before the edit');

    const edited = read(sheet).replace('rgb(1, 1, 1)', 'rgb(9, 9, 9)');
    await evaluate(edited, sheet, beside(sheet, 'swap-b'));
    await settle();

    assert.deepEqual(backgrounds(fabric), ['rgb(9, 9, 9)'], 'the new rule reached the live view');
    assert.equal(instance.count(), 1, 'with the state it had');
    assert.deepEqual(reloads, [], 'and nothing asked for a reload');
  });

  it('applies the edited sheet after a reload, when the screen module is stale', async () => {
    // The screen's module is served from Metro's cache, compiled against the sheet as it was.
    const edited = read(sheet).replace('rgb(1, 1, 1)', 'rgb(7, 7, 7)');
    await evaluate(edited, sheet, beside(sheet, 'stale-a'));
    const mod = await evaluate(read(home), home, beside(home, 'stale-a'));
    const { fabric } = await render(mod['Home'] as Type<unknown>);
    assert.deepEqual(backgrounds(fabric), ['rgb(7, 7, 7)'], 'the edit, not the cached copy');
  });
});

/**
 * Who installs the hook the block above calls.
 *
 * Nobody did. `__angularNativeReload` was defined in one example app's entry file and nowhere
 * else, so in every other app a non-template edit logged "hmr reload" and then called
 * `function () {}` - while `module.hot.accept()` told Metro the update was handled, so it did not
 * fall back either. The new module had been evaluated, giving a second copy of every class in it
 * (`NG0912: Component ID generation collision`), the running app went on holding the old ones, and
 * the edit simply never arrived. Three separate device investigations in one afternoon reached
 * the wrong conclusion because of it: the screenshots were of code from before the edit.
 *
 * So it is installed by `mount`, which every app calls, rather than by a line every app has to
 * remember.
 */
describe('the reload hook', () => {
  const hook = () => (globalThis as Record<string, unknown>)['__angularNativeReload'];

  let Features: Type<unknown>;
  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/features.ts', import.meta.url)),
    );
    Features = mod['Features'] as Type<unknown>;
  });

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)['__angularNativeReload'];
    (globalThis as Record<string, unknown>)['__DEV__'] = true;
  });

  after(() => {
    delete (globalThis as Record<string, unknown>)['__angularNativeReload'];
    delete (globalThis as Record<string, unknown>)['__DEV__'];
  });
  afterEach(cleanup);

  it('is installed by mounting, so no app has to remember it', async () => {
    await render(Features);
    assert.equal(typeof hook(), 'function');
  });

  it('leaves an app that installed its own alone', async () => {
    // `examples/canary` sets one with its own reason string. Replacing it would be rude, and the
    // app's is the one with the context in it.
    const mine = () => {};
    (globalThis as Record<string, unknown>)['__angularNativeReload'] = mine;
    await render(Features);
    assert.equal(hook(), mine);
  });

  it('installs nothing in a release build', async () => {
    // There is no Metro to reload from, and reaching for `DevSettings` at startup to do nothing
    // is work a shipped app should not be doing.
    (globalThis as Record<string, unknown>)['__DEV__'] = false;
    await render(Features);
    assert.equal(hook(), undefined);
  });

  it('lets the router park its history before the app goes', async () => {
    // The reload takes the JavaScript runtime with it, so what the router leaves for the app that
    // comes back has to have left before then.
    const scope = globalThis as Record<string, unknown>;
    const order: string[] = [];
    scope['__angularNativePark'] = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push('parked');
    };
    scope['__ReactRefresh'] = { performFullRefresh: () => order.push('metro reloaded') };
    scope['require'] = (id: string) => {
      if (id === 'react-native') return { DevSettings: { reload: () => order.push('reloaded') } };
      throw new Error(`Cannot find module '${id}'`);
    };
    try {
      await render(Features);
      (hook() as () => void)();
      (scope['__ReactRefresh'] as { performFullRefresh(reason: string): void }).performFullRefresh(
        'reason',
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      delete scope['__angularNativePark'];
      delete scope['__ReactRefresh'];
      delete scope['require'];
    }
    assert.deepEqual(order, ['parked', 'reloaded', 'parked', 'metro reloaded']);
  });

  it('keeps the app out of sight until the router has gone back through its history', async () => {
    // Otherwise a reload comes back on the first page, with the others arriving over it.
    const scope = globalThis as Record<string, unknown>;
    let restored!: () => void;
    scope['__angularNativeRestoring'] = new Promise<void>((resolve) => (restored = resolve));
    const opacity = (fabric: FakeFabric) => fabric.committed[0]!.props['opacity'];
    try {
      const { fabric } = await render(Features);
      assert.equal(opacity(fabric), 0, 'hidden while the history is gone through');
      restored();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.notEqual(opacity(fabric), 0, 'and shown once it has been');
    } finally {
      delete scope['__angularNativeRestoring'];
    }
  });

  it('reloads all the same when parking fails', async () => {
    const scope = globalThis as Record<string, unknown>;
    const order: string[] = [];
    scope['__angularNativePark'] = () => Promise.reject(new Error('no dev server'));
    scope['require'] = (id: string) => {
      if (id === 'react-native') return { DevSettings: { reload: () => order.push('reloaded') } };
      throw new Error(`Cannot find module '${id}'`);
    };
    try {
      await render(Features);
      (hook() as () => void)();
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      delete scope['__angularNativePark'];
      delete scope['require'];
    }
    assert.deepEqual(order, ['reloaded']);
  });

  /**
   * Metro reloads the app itself for an edit nothing accepted, a route file or a service, through
   * React Native's Fast Refresh runtime, which calls `DevSettings.reload()`. In Expo Go that brings
   * the app back without Expo's native modules (`Cannot find native module 'ExpoFontLoader'`)
   * until Expo Go is relaunched.
   */
  describe("Metro's own full reload", () => {
    const scope = globalThis as Record<string, unknown>;
    let calls: string[];
    const refresh = () =>
      scope['__ReactRefresh'] as { performFullRefresh(reason: string): void } | undefined;

    beforeEach(() => {
      calls = [];
      scope['__ReactRefresh'] = {
        performFullRefresh: (reason: string) => calls.push(`DevSettings.reload: ${reason}`),
      };
    });
    afterEach(() => {
      delete scope['__ReactRefresh'];
      delete scope['require'];
    });

    const withExpo = () => {
      scope['require'] = (id: string) => {
        if (id === 'expo') {
          return { reloadAppAsync: async (reason: string) => void calls.push(`expo: ${reason}`) };
        }
        throw new Error(`Cannot find module '${id}'`);
      };
    };

    it("goes through Expo's reload in an Expo app", async () => {
      withExpo();
      await render(Features);
      refresh()!.performFullRefresh('Fast Refresh - No root boundary');
      assert.deepEqual(calls, ['expo: Fast Refresh - No root boundary']);
    });

    it("falls back to React Native's reload when Expo's rejects", async () => {
      scope['require'] = (id: string) => {
        if (id === 'expo') return { reloadAppAsync: () => Promise.reject(new Error('no reload')) };
        throw new Error(`Cannot find module '${id}'`);
      };
      const errors: unknown[] = [];
      const error = console.error;
      console.error = (...args: unknown[]) => void errors.push(args);
      try {
        await render(Features);
        await render(Features);
        refresh()!.performFullRefresh('reason');
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        console.error = error;
      }
      assert.deepEqual(calls, ['DevSettings.reload: reason'], 'once, after a second mount too');
      const said = errors.filter((args) => /Expo's reload failed/.test(String(args)));
      assert.equal(said.length, 1, 'and says why');
    });

    it("falls back to React Native's reload when Expo's resolves and reloads nothing", async (t) => {
      // Expo Go on Android: `reloadAppAsync` resolves, the app goes on running, and the edit that
      // asked for the reload never arrives. A reload takes this code with it, so still running a
      // moment later is how it knows.
      withExpo();
      await render(Features);
      const error = console.error;
      const errors: unknown[] = [];
      console.error = (...args: unknown[]) => void errors.push(args);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        refresh()!.performFullRefresh('reason');
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.deepEqual(calls, ['expo: reason'], "Expo's first");
        t.mock.timers.tick(2000);
      } finally {
        console.error = error;
      }
      assert.deepEqual(calls, ['expo: reason', 'DevSettings.reload: reason']);
      assert.equal(errors.filter((args) => /did nothing/.test(String(args))).length, 1);
    });

    it("carries DevMenu.reload() through Expo's reload too", async () => {
      // DevSettings.reload() in Expo Go brought the app back without Expo's native modules.
      scope['require'] = (id: string) => {
        if (id === 'expo') {
          return { reloadAppAsync: async (reason: string) => void calls.push(`expo: ${reason}`) };
        }
        if (id === 'react-native') {
          const reload = (reason?: string) => void calls.push(`DevSettings.reload: ${reason}`);
          return { DevSettings: { addMenuItem: () => {}, reload } };
        }
        throw new Error(`Cannot find module '${id}'`);
      };
      await render(Features);
      const provider = (DevMenu.SOURCE as unknown as { ɵprov: { factory(): DevMenuSource } }).ɵprov;
      scope['nativeFabricUIManager'] = {};
      let source: DevMenuSource;
      try {
        source = provider.factory();
      } finally {
        delete scope['nativeFabricUIManager'];
      }
      serviceWith(DevMenu.SOURCE, source, () => new DevMenu()).reload('reset');
      assert.deepEqual(calls, ['expo: reset']);
    });

    it("stays React Native's outside Expo", async () => {
      await render(Features);
      refresh()!.performFullRefresh('Fast Refresh - No root boundary');
      assert.deepEqual(calls, ['DevSettings.reload: Fast Refresh - No root boundary']);
    });

    it('is left alone in a release build', async () => {
      withExpo();
      scope['__DEV__'] = false;
      await render(Features);
      refresh()!.performFullRefresh('reason');
      assert.deepEqual(calls, ['DevSettings.reload: reason']);
    });
  });
});
