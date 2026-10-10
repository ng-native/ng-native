/**
 * One component, rendered on a device and in a browser, styled the same.
 *
 * The two hosts share components and nothing below them. On a device, a component's CSS is
 * compiled into a rule set the engine cascades itself, and every value reaches Fabric as a React
 * Native prop. In a browser, the CSS stays CSS, `[style]` is written inline by
 * `@ng-native/web`'s renderer, and the browser does the cascade. Each half is tested on its own,
 * which is how a value could be right in both suites and different on the two screens: the
 * browser dropping a React Native key both suites considered written, or the engine inheriting a
 * font the browser does not.
 *
 * So `fixtures/web-parity.ts` is compiled both ways and rendered both ways - through the fake
 * Fabric, and through `mount()` in jsdom - and every style prop the device receives is looked up
 * in the browser's computed style through `CSS`, a deliberately small table of what each React
 * Native prop is called in CSS and how its value is written there. A prop the device receives
 * that the table does not name fails the test rather than being skipped.
 *
 * jsdom stands in for the browser with two gaps, both filled explicitly below rather than
 * papered over: it never matches `:active`, and it inherits `color` but no font property. The
 * real cascade for both is `packages/web/browser`'s to prove.
 *
 * The second half does the same for what a component says rather than how it looks.
 * `fixtures/web-parity-components.ts` holds every component in `@ng-native/components`, and each
 * accessibility prop a device receives - role, label, hint, state, value, live region - and each
 * prop the web gives a meaning to is looked up on the element the browser has, through `MEANS`.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture, compileFixtureForWeb } from './compile.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/web-parity.ts', import.meta.url));

const px = (value: unknown): string => `${value as number}px`;
const same = (value: unknown): string => String(value);
/** `[{ translateX: 10 }, { rotate: '45deg' }]` as CSS writes it. Only translations take units. */
const transform = (value: unknown): string =>
  (value as Record<string, unknown>[])
    .flatMap((step) => Object.entries(step))
    .map(([fn, arg]) => `${fn}(${fn.startsWith('translate') ? px(arg) : same(arg)})`)
    .join(' ');

/** Each React Native style prop the fixture produces: its CSS property, and its value in CSS. */
const CSS: Record<string, readonly [property: string, value: (native: unknown) => string]> = {
  backgroundColor: ['background-color', same],
  opacity: ['opacity', same],
  borderTopLeftRadius: ['border-top-left-radius', px],
  color: ['color', same],
  fontSize: ['font-size', px],
  fontWeight: ['font-weight', same],
  fontStyle: ['font-style', same],
  letterSpacing: ['letter-spacing', px],
  flexDirection: ['flex-direction', same],
  justifyContent: ['justify-content', same],
  alignItems: ['align-items', same],
  flexGrow: ['flex-grow', same],
  rowGap: ['row-gap', px],
  columnGap: ['column-gap', px],
  paddingTop: ['padding-top', px],
  paddingRight: ['padding-right', px],
  paddingBottom: ['padding-bottom', px],
  paddingLeft: ['padding-left', px],
  width: ['width', px],
  transform: ['transform', transform],
};

/** What a device node carries besides style: identity, accessibility and event subscriptions. */
const NOT_STYLE = new Set([
  'testID',
  'accessible',
  'focusable',
  'collapsable',
  'ellipsizeMode',
  // One line for text with nowhere to wrap, which a browser's text is with no style to say so.
  'numberOfLines',
  'onLayout',
  'onPointerEnter',
  'onPointerLeave',
]);

/** The properties CSS inherits, among the ones this fixture sets on an ancestor. */
const INHERITED = new Set(['color', 'font-size', 'font-weight', 'font-style', 'letter-spacing']);

describe('a component on a device and in a browser', () => {
  const device = new Map<string, Record<string, unknown>>();
  let web: typeof import('./fixtures/web-parity.ts');
  let document: Document;
  let window: Window;
  let root: Element;

  before(async () => {
    const native = await compileFixture(FIXTURE);
    const { getByTestId, fabric } = await render(native['WebParity'] as Type<unknown>);
    const props = (id: string) => ({ ...getByTestId(id, { includeHiddenElements: true }).props });
    for (const id of ['press', 'inherited', 'row', 'moved']) device.set(id, props(id));
    const press: FakeFabricNode = getByTestId('press');
    fabric.emit(press, 'topTouchStart', { touches: [{}], changedTouches: [{}] });
    await settle();
    device.set('press:active', props('press'));
    cleanup();

    const { installJsdomEnvironment } = await import('../web/src/jsdom-env.ts');
    ({ document, window } = installJsdomEnvironment());
    // The web copy is the same class to Angular's component-id hash, which leaves styles out, so
    // defining it warns of a collision. It is a real one and a harmless one: the two copies never
    // share a renderer factory, which is the only thing that keys on the id.
    const devMode = (globalThis as { ngDevMode?: unknown }).ngDevMode;
    (globalThis as { ngDevMode?: unknown }).ngDevMode = false;
    web = (await compileFixtureForWeb(FIXTURE)) as typeof web;
    (globalThis as { ngDevMode?: unknown }).ngDevMode = devMode;
    const { mount } = await import('../web/src/mount.ts');
    root = document.createElement('app-root');
    document.body.appendChild(root);
    mount(root, web.WebParity);
  });

  after(() => root?.remove());

  const element = (id: string): Element => {
    const found = document.querySelector(`[data-testid="${id}"]`);
    assert.ok(found, `nothing in the page has testID ${id}`);
    return found;
  };

  /** Computed, with the inheritance jsdom leaves out: the nearest ancestor that has a value. */
  function computed(el: Element, property: string): string {
    for (let at: Element | null = el; at; at = at.parentElement) {
      const value = window.getComputedStyle(at).getPropertyValue(property);
      if (value || !INHERITED.has(property)) return value;
    }
    return '';
  }

  /**
   * What the page's own `:active` rules add while `el` is pressed, which jsdom will not match:
   * each rule whose selector matches `el` with `:active` taken out, in sheet order.
   */
  function whilePressed(el: Element): Map<string, string> {
    const declared = new Map<string, string>();
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
        if (!rule.selectorText?.includes(':active')) continue;
        if (!el.matches(rule.selectorText.replaceAll(':active', ''))) continue;
        for (const property of Array.from(rule.style)) {
          declared.set(property, rule.style.getPropertyValue(property));
        }
      }
    }
    return declared;
  }

  /** Every style prop the device received, beside what the browser has for it. */
  function compare(id: string, read: (property: string) => string): void {
    const props = device.get(id)!;
    const styled = Object.keys(props).filter((key) => !NOT_STYLE.has(key));
    assert.ok(styled.length > 0, `${id} received no style at all`);
    for (const key of styled) {
      const entry = CSS[key];
      assert.ok(entry, `${id} received ${key}, which the CSS table does not name`);
      const [property, toCss] = entry;
      assert.equal(read(property), toCss(props[key]), `${id}: ${key} / ${property}`);
    }
  }

  it("resolves a pressable's own class the same way", () => {
    compare('press', (property) => computed(element('press'), property));
  });

  it('applies its :active rule the same way while it is pressed', () => {
    const el = element('press');
    const pressed = whilePressed(el);
    assert.ok(pressed.size > 0, 'the :active rule reached the page, scoped to this element');
    compare('press:active', (property) => pressed.get(property) ?? computed(el, property));
  });

  it("gives a text the font its parent's class sets", () => {
    compare('inherited', (property) => computed(element('inherited'), property));
  });

  it('lays out a row from its class and its [style] together', () => {
    compare('row', (property) => computed(element('row'), property));
  });

  it('moves a view by the transform list in its [style]', () => {
    compare('moved', (property) => computed(element('moved'), property));
  });
});

const EVERY_COMPONENT = fileURLToPath(
  new URL('./fixtures/web-parity-components.ts', import.meta.url),
);

/** Every `testID` in `fixtures/web-parity-components.ts`, one per component or usage. */
const IDS = [
  'provider',
  'view',
  'heading',
  'text',
  'pressable',
  'disabled',
  'toggle',
  'opacity',
  'image',
  'image-background',
  'input',
  'locked',
  'switch',
  'switch-off',
  'spinner',
  'slider',
  'hidden',
  'live',
  'scroll',
  'avoiding',
  'safe',
  'list',
  'sections',
  'modal',
];

/** The ARIA role each React Native role this fixture uses stands for in a browser. */
const ARIA_ROLE: Record<string, string> = {
  adjustable: 'slider',
  button: 'button',
  header: 'heading',
  image: 'img',
  summary: 'region',
  switch: 'switch',
  togglebutton: 'button',
};

type Shown = [what: string, web: unknown, expected: unknown];
type Check = (native: unknown, el: HTMLElement, props: Record<string, unknown>) => Shown[];

const attr =
  (name: string, toWeb: (native: unknown) => unknown = String): Check =>
  (native, el) => [[name, el.getAttribute(name), toWeb(native)]];

/** `accessibilityState`, key by key. A checked button is pressed, which is ARIA's word for it. */
const state: Check = (native, el, props) => {
  const button = ARIA_ROLE[props['accessibilityRole'] as string] === 'button';
  const shown: Shown[] = [];
  for (const [key, value] of Object.entries(native as Record<string, unknown>)) {
    if (value === undefined) continue;
    const name = key === 'checked' && button ? 'aria-pressed' : `aria-${key}`;
    const onlyWhenTrue = key === 'disabled' || key === 'busy';
    shown.push([name, el.getAttribute(name), onlyWhenTrue && !value ? null : String(value)]);
  }
  return shown;
};

/**
 * What a device prop means, read back out of the element the browser has. A prop not named here
 * is not compared: most are platform tuning with no web meaning, which `props.ts` documents.
 */
const MEANS: Record<string, Check> = {
  accessibilityLabel: attr('aria-label'),
  accessibilityHint: attr('aria-description'),
  accessibilityRole: attr('role', (role) => ARIA_ROLE[role as string] ?? role),
  accessibilityLiveRegion: attr('aria-live'),
  accessibilityElementsHidden: attr('aria-hidden', (hidden) => (hidden ? 'true' : null)),
  focusable: attr('tabindex', (focusable) => (focusable ? '0' : '-1')),
  accessibilityState: state,
  accessibilityValue: (native, el) =>
    Object.entries(native as Record<string, unknown>).map(([key, value]) => [
      `aria-value${key}`,
      el.getAttribute(`aria-value${key}`),
      String(value),
    ]),
  placeholder: attr('placeholder'),
  maxLength: attr('maxlength'),
  keyboardType: attr('inputmode', (type) => (type === 'email-address' ? 'email' : type)),
  returnKeyType: attr('enterkeyhint'),
  text: (native, el) => [['value', (el as HTMLTextAreaElement).value, native]],
  editable: (native, el) => [['readOnly', (el as HTMLTextAreaElement).readOnly, native === false]],
  // A list of sources, by scale; a browser paints the first.
  source: (native, el) => [
    [
      'background-image',
      el.style.backgroundImage,
      `url("${([native].flat() as { uri: string }[])[0]!.uri}")`,
    ],
  ],
  resizeMode: (native, el) => [['background-size', el.style.backgroundSize, native]],
};

/** Props compared on one element only, where the same name means something else elsewhere. */
const ON: Record<string, Record<string, Check>> = {
  switch: {
    value: (native, el) => [['checked', (el as HTMLInputElement).checked, native === true]],
    disabled: (native, el) => [['disabled', (el as HTMLInputElement).disabled, native === true]],
  },
  modal: {
    visible: (native, el) => [['hidden', el.hasAttribute('hidden'), native === false]],
  },
};

describe('every component, on a device and in a browser', () => {
  const device = new Map<string, Record<string, unknown>>();
  let document: Document;

  before(async () => {
    const native = await compileFixture(EVERY_COMPONENT);
    const { getByTestId } = await render(native['WebParityComponents'] as Type<unknown>);
    for (const id of IDS)
      device.set(id, { ...getByTestId(id, { includeHiddenElements: true }).props });
    cleanup();

    const { installJsdomEnvironment } = await import('../web/src/jsdom-env.ts');
    ({ document } = installJsdomEnvironment());
    // The same component-id collision the test above explains, and as harmless.
    const devMode = (globalThis as { ngDevMode?: unknown }).ngDevMode;
    (globalThis as { ngDevMode?: unknown }).ngDevMode = false;
    const web = await compileFixtureForWeb(EVERY_COMPONENT);
    (globalThis as { ngDevMode?: unknown }).ngDevMode = devMode;
    const { mount } = await import('../web/src/mount.ts');
    const root = document.createElement('app-root');
    document.body.appendChild(root);
    mount(root, web['WebParityComponents'] as Type<unknown>);
  });

  for (const id of IDS) {
    it(`says the same thing about ${id}`, () => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      assert.ok(el, `nothing in the page has testID ${id}`);
      const props = device.get(id)!;
      const own = ON[el.getAttribute('data-rn') ?? ''] ?? {};
      for (const [key, value] of Object.entries(props)) {
        const check = own[key] ?? MEANS[key];
        if (!check || value === undefined || value === null) continue;
        for (const [what, web, expected] of check(value, el, props)) {
          assert.equal(web, expected, `${id}: ${key} as ${what}`);
        }
      }
    });
  }
});
