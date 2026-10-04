/**
 * Angular HMR over Metro: a template edit hot-swaps on a live component, anything else reloads,
 * and the reload hook that fallback calls is installed by mounting.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
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

  it('asks for a reload when the change is not template-only', async () => {
    const filename = fixture('list.ts');
    const source = readFileSync(filename, 'utf8');

    await evaluate(source, filename, fixture('list.hmr-a.generated.ts'));

    const reloads: unknown[] = [];
    (globalThis as Record<string, unknown>)['__angularNativeReload'] = (id: unknown) =>
      reloads.push(id);

    // A new method is not expressible as a metadata replacement.
    const edited = source.replace('setItems(', 'brandNewMethod(): void {}\n\n  setItems(');
    await evaluate(edited, filename, fixture('list.hmr-b.generated.ts'));

    assert.equal(reloads.length, 1, 'fell back to a reload rather than patching silently');
    delete (globalThis as Record<string, unknown>)['__angularNativeReload'];
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
