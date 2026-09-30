/**
 * A component's own `styles`, on the web: applied, and scoped to that component the way Angular's
 * emulated encapsulation scopes them in any other browser app.
 *
 * On a device a component's CSS is compiled into a rule set hung off its class, and its renderer
 * only ever matches its own elements against it. The browser equivalent is Angular's own: the
 * compiler rewrites each selector to carry `[_ngcontent-%COMP%]`/`[_nghost-%COMP%]`, and the
 * renderer stamps those attributes on the elements a component creates and on its host.
 *
 * The components here are compiled just in time, because this package's linker loader compiles
 * fixtures with Metro's transform, and that transform empties `styles` into the native rule set -
 * which is right for a phone and leaves nothing for a browser to read.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { installJsdomEnvironment } from './jsdom-env.ts';

describe("a component's own styles, on the web", () => {
  let document: Document;
  let window: Window;
  let mount: typeof import('./mount.ts').mount;
  let Component: typeof import('@angular/core').Component;
  let ViewEncapsulation: typeof import('@angular/core').ViewEncapsulation;
  let View: Type<unknown>;
  let Text: Type<unknown>;
  let ScrollView: Type<unknown>;
  let KeyboardAvoidingView: Type<unknown>;

  before(async () => {
    ({ document, window } = installJsdomEnvironment());
    await import('@angular/compiler');
    const core = await import('@angular/core');
    Component = core.Component;
    ViewEncapsulation = core.ViewEncapsulation;
    ({ mount } = await import('./mount.ts'));
    ({ View, Text, ScrollView, KeyboardAvoidingView } = await import('./component-styles-app.ts'));
  });

  function root(): HTMLElement {
    const element = document.createElement('app-root');
    document.body.appendChild(element);
    return element;
  }

  const colour = (element: Element | null): string =>
    element ? window.getComputedStyle(element).backgroundColor : '(missing)';

  it('applies them to the elements its template creates', () => {
    const Card = Component({
      selector: 'app-card',
      imports: [View, Text],
      template: `<view class="card" id="styled"><text>Hi</text></view>`,
      styles: `.card { background-color: rgb(255, 0, 0); }`,
    })(class {});
    const host = root();
    mount(host, Card);
    assert.equal(colour(host.querySelector('#styled')), 'rgb(255, 0, 0)');
  });

  it('keeps them off an element of the same class in another component', () => {
    const Plain = Component({
      selector: 'app-plain',
      imports: [View],
      template: `<view class="card" id="unstyled"></view>`,
    })(class {});
    const Styled = Component({
      selector: 'app-styled',
      imports: [View, Plain],
      template: `<view class="card" id="own"></view><app-plain />`,
      styles: `.card { background-color: rgb(0, 128, 0); }`,
    })(class {});
    const host = root();
    mount(host, Styled);
    assert.equal(colour(host.querySelector('#own')), 'rgb(0, 128, 0)');
    assert.notEqual(colour(host.querySelector('#unstyled')), 'rgb(0, 128, 0)');
  });

  it('reaches the host element through :host', () => {
    const Child = Component({
      selector: 'app-child',
      imports: [View],
      template: `<view></view>`,
      styles: `:host { background-color: rgb(0, 0, 255); }`,
    })(class {});
    const Parent = Component({
      selector: 'app-parent',
      imports: [Child],
      template: `<app-child id="child-host" />`,
    })(class {});
    const host = root();
    mount(host, Parent);
    assert.equal(colour(host.querySelector('#child-host')), 'rgb(0, 0, 255)');
  });

  it('adds one stylesheet per component, however many times it renders', () => {
    const Repeated = Component({
      selector: 'app-repeated',
      imports: [View],
      template: `<view class="repeated"></view>`,
      styles: `.repeated { background-color: rgb(1, 2, 3); }`,
    })(class {});
    const Twice = Component({
      selector: 'app-twice',
      imports: [Repeated],
      template: `<app-repeated /><app-repeated />`,
    })(class {});
    mount(root(), Twice);
    const sheets = [...document.head.querySelectorAll('style')].filter((style) =>
      style.textContent?.includes('rgb(1, 2, 3)'),
    );
    assert.equal(sheets.length, 1);
  });

  it('keeps custom properties by the names they were written with', () => {
    // Angular 22's compiler writes `--%NS%name` for every custom property in a component's
    // styles, for the renderer to fill with a namespace. Left in, no `var()` ever resolves.
    const Themed = Component({
      selector: 'app-themed',
      imports: [View],
      template: `<view class="themed"></view>`,
      styles: `.themed { --tint: rgb(0, 0, 255); padding-top: calc(var(--safe-area-inset-top, 0px) + 4px); }`,
    })(class {});
    mount(root(), Themed);
    const sheet = [...document.head.querySelectorAll('style')].find((style) =>
      style.textContent?.includes('.themed'),
    );
    assert.ok(sheet, 'the stylesheet is in the document');
    assert.doesNotMatch(sheet.textContent ?? '', /%NS%/);
    assert.match(sheet.textContent ?? '', /--tint:\s*rgb\(0, 0, 255\)/);
    assert.match(sheet.textContent ?? '', /var\(--safe-area-inset-top, 0px\)/);
  });

  it('sets a bound custom property by the name it was written with', () => {
    // `[style.--tint]` compiles to `setStyle('--%NS%tint', ...)` in Angular 22, the same
    // placeholder a stylesheet gets. A custom property's name is case-sensitive, so it is not
    // dash-cased either, and its value is the value: a number is not a length.
    const Bound = Component({
      selector: 'app-bound',
      imports: [View],
      host: { '[style.--gap]': "'4px'" },
      template: `<view id="bound" class="bound" [style.--tint]="tint" [style.--brandTint]="tint" [style.--columns]="3"></view>`,
      styles: `.bound { background-color: var(--tint); }`,
    })(
      class {
        tint = 'rgb(0, 0, 255)';
      },
    );
    const host = root();
    mount(host, Bound);
    const bound = host.querySelector('#bound') as HTMLElement;
    assert.doesNotMatch(bound.style.cssText, /%NS%/);
    assert.equal(bound.style.getPropertyValue('--tint'), 'rgb(0, 0, 255)');
    assert.equal(bound.style.getPropertyValue('--brandTint'), 'rgb(0, 0, 255)');
    assert.equal(bound.style.getPropertyValue('--columns'), '3');
    const hostElement = host.querySelector('app-bound') ?? host;
    assert.equal((hostElement as HTMLElement).style.getPropertyValue('--gap'), '4px');
  });

  it('reach a content container through contentContainerClass, and let go when it goes', async () => {
    const { signal } = await import('@angular/core');
    const classes = signal<string | undefined>('card');
    const Screen = Component({
      selector: 'app-screen',
      imports: [KeyboardAvoidingView, ScrollView, Text, View],
      template: `
        <scroll-view id="classed" [contentContainerClass]="classes()"><text>Row</text></scroll-view>
        <keyboard-avoiding-view id="avoiding" behavior="position" [contentContainerClass]="classes()"
          ><text>Field</text></keyboard-avoiding-view
        >
        <scroll-view id="plain"><view class="inner"></view></scroll-view>
      `,
      styles: `.card { background-color: rgb(1, 2, 3); } view { color: rgb(4, 5, 6); }`,
    })(
      class {
        classes = classes;
      },
    );
    const host = root();
    const { applicationRef } = mount(host, Screen);
    const text = (element: Element | null) =>
      element ? window.getComputedStyle(element).color : '(missing)';
    for (const id of ['#classed > view', '#avoiding > view']) {
      assert.equal(colour(host.querySelector(id)), 'rgb(1, 2, 3)', id);
      assert.equal(text(host.querySelector(id)), 'rgb(4, 5, 6)', id);
    }
    // Without a class the content view stays the component's own, out of this component's reach.
    assert.notEqual(text(host.querySelector('#plain > view')), 'rgb(4, 5, 6)');
    assert.equal(text(host.querySelector('.inner')), 'rgb(4, 5, 6)');

    classes.set(undefined);
    applicationRef.tick();
    for (const id of ['#classed > view', '#avoiding > view']) {
      assert.notEqual(text(host.querySelector(id)), 'rgb(4, 5, 6)', `${id} let go`);
    }
  });

  it('applies them unscoped when encapsulation is None', () => {
    const Global = Component({
      selector: 'app-global',
      imports: [View],
      template: `<view></view>`,
      styles: `.global-target { background-color: rgb(9, 9, 9); }`,
      encapsulation: ViewEncapsulation.None,
    })(class {});
    mount(root(), Global);
    const outside = document.createElement('div');
    outside.className = 'global-target';
    document.body.appendChild(outside);
    assert.equal(colour(outside), 'rgb(9, 9, 9)');
  });
});
