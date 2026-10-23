import '@angular/localize/init';
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { ComponentRef, Type } from '@angular/core';
import { installJsdomEnvironment } from './jsdom-env.ts';

type Fixtures = typeof import('./plural-app.ts');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (root: HTMLElement) => root.textContent?.replace(/\s+/g, ' ').trim();

describe('an ICU plural, on the web, in a development build', () => {
  let document: Document;
  let mount: typeof import('./mount.ts').mount;
  let fixtures: Fixtures;
  const mounted: ComponentRef<unknown>[] = [];

  before(async () => {
    ({ document } = installJsdomEnvironment());
    [{ mount }, fixtures] = await Promise.all([import('./mount.ts'), import('./plural-app.ts')]);
  });

  afterEach(() => {
    for (const ref of mounted.splice(0)) ref.destroy();
  });

  function mountApp<T>(component: Type<T>): { root: HTMLElement; ref: ComponentRef<T> } {
    const root = document.createElement('app-root');
    document.body.appendChild(root);
    const ref = mount(root, component).componentRef as ComponentRef<T>;
    mounted.push(ref);
    return { root, ref };
  }

  it('renders the case for the count, and switches case both ways', async () => {
    const { root, ref } = mountApp(fixtures.PluralApp);
    assert.equal(text(root), '1 result');
    ref.instance.count.set(3);
    await settle();
    assert.equal(text(root), '3 results');
    ref.instance.count.set(1);
    await settle();
    assert.equal(text(root), '1 result');
  });

  it('renders the case for the value of a select, and switches case both ways', async () => {
    const { root, ref } = mountApp(fixtures.SelectApp);
    assert.equal(text(root), 'Administrator');
    ref.instance.role.set('visitor');
    await settle();
    assert.equal(text(root), 'Guest');
    ref.instance.role.set('admin');
    await settle();
    assert.equal(text(root), 'Administrator');
  });

  it('renders a plural next to an element in the same message', async () => {
    const { root, ref } = mountApp(fixtures.PluralBesideElementApp);
    assert.equal(text(root), 'Found 1 match');
    ref.instance.count.set(2);
    await settle();
    assert.equal(text(root), 'Found 2 matches');
  });

  it('takes a plural down with the view it is in', async () => {
    const { root, ref } = mountApp(fixtures.PluralInViewApp);
    assert.equal(text(root), 'one left');
    ref.instance.shown.set(false);
    await settle();
    assert.equal(text(root), '');
    ref.instance.shown.set(true);
    await settle();
    assert.equal(text(root), 'one left');
  });

  it('answers instanceof Node for its own nodes only', () => {
    const { ref } = mountApp(fixtures.PluralApp);
    const wrapper = ref.location.nativeElement as object;
    assert.ok(wrapper instanceof Node);
    assert.ok(document.createComment('') instanceof Node);
    assert.ok(!(document.createTextNode('') instanceof Element));
    assert.ok(!({} instanceof Node));
  });

  it('picks the case by the rules of LOCALE_ID, not of en-US', async () => {
    const [{ registerLocaleData }, { default: localeFr }, core] = await Promise.all([
      import('@angular/common'),
      import('@angular/common/locales/fr'),
      import('@angular/core'),
    ]);
    registerLocaleData(localeFr);
    try {
      const root = document.createElement('app-root');
      document.body.appendChild(root);
      const { componentRef } = mount(root, fixtures.PluralApp, {
        providers: [{ provide: core.LOCALE_ID, useValue: 'fr' }],
      });
      mounted.push(componentRef);
      (componentRef.instance as InstanceType<Fixtures['PluralApp']>).count.set(0);
      await settle();
      assert.equal(text(root), '0 result');
    } finally {
      core.ɵsetLocaleId(core.ɵDEFAULT_LOCALE_ID);
    }
  });
});

describe('an ICU plural, on the web, in a release build', () => {
  const scope = globalThis as { ngDevMode?: unknown };

  it('renders, and its nodes still answer instanceof Node as on iOS and Android', async () => {
    const before = scope.ngDevMode;
    const { document } = installJsdomEnvironment();
    scope.ngDevMode = false;
    try {
      const [{ mount }, { PluralApp }] = await Promise.all([
        import('./mount.ts'),
        import('./plural-app.ts'),
      ]);
      const root = document.createElement('app-root');
      document.body.appendChild(root);
      const { componentRef } = mount(root, PluralApp);
      try {
        (componentRef.instance as InstanceType<typeof PluralApp>).count.set(2);
        await settle();
        assert.equal(text(root), '2 results');
        assert.ok((componentRef.location.nativeElement as object) instanceof Node);
      } finally {
        componentRef.destroy();
      }
    } finally {
      scope.ngDevMode = before;
    }
  });
});
