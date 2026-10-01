/**
 * `text-input.ts`, `switch.ts` and `image-background.ts` against `BrowserEngine` - components
 * that need something beyond `ViewBase`'s generic accessibility surface: a real text field, a
 * real toggle, and (`image-background.ts`) a component that reads `this.node.props['style']`
 * directly rather than through the engine (see `browser-renderer.ts`'s doc comment for why that
 * has to stay in sync with the real inline style rather than only with what was last bound).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ControlsApp } from './controls-app.ts';
import { installJsdomEnvironment } from './jsdom-env.ts';

async function bootstrapControls() {
  const { document } = installJsdomEnvironment();
  const [{ mount }, { ControlsApp }] = await Promise.all([
    import('./mount.ts'),
    import('./controls-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const { componentRef, applicationRef } = mount(root, ControlsApp);
  return { document, componentRef, applicationRef, app: componentRef.instance as ControlsApp };
}

describe('text-input, over a real <input>', () => {
  it('commits as an input and carries the placeholder', async () => {
    const { document, componentRef } = await bootstrapControls();
    const field = document.querySelector('[data-rn="text-input"]') as HTMLInputElement;

    assert.equal(field.tagName, 'INPUT');
    assert.equal(field.placeholder, 'Say something');

    componentRef.destroy();
  });

  it('reflects a real keystroke back into the value model', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const field = document.querySelector('[data-rn="text-input"]') as HTMLInputElement;

    field.value = 'hello';
    field.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
    appRef.tick();

    assert.equal(app.text(), 'hello', '(change) -> TextInput.onNativeChange -> the value model');

    componentRef.destroy();
  });

  it('reflects a model change back into the field, through the same engine.setProp path', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const field = document.querySelector('[data-rn="text-input"]') as HTMLInputElement;

    app.text.set('set from code');
    appRef.tick();

    assert.equal(field.value, 'set from code');

    componentRef.destroy();
  });
});

describe('switch, over a real checkbox', () => {
  it('commits as a checkbox with the switch role', async () => {
    const { document, componentRef } = await bootstrapControls();
    const toggle = document.querySelector('[data-rn="switch"]') as HTMLInputElement;

    assert.equal(toggle.type, 'checkbox');
    assert.equal(
      toggle.getAttribute('role'),
      'switch',
      "Switch.roleByDefault() -> ViewBase's normal pipeline",
    );

    componentRef.destroy();
  });

  it('reflects a real click back into the checked model', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const toggle = document.querySelector('[data-rn="switch"]') as HTMLInputElement;

    toggle.checked = true;
    toggle.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
    appRef.tick();

    assert.equal(app.on(), true);

    componentRef.destroy();
  });

  it('unticks the checkbox again when the app refuses the flip', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const toggle = document.querySelectorAll('[data-rn="switch"]')[1] as HTMLInputElement;

    toggle.checked = true;
    toggle.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
    appRef.tick();

    assert.equal(app.kept(), false);
    assert.equal(toggle.checked, false, 'the setValue command reached the checkbox');

    componentRef.destroy();
  });

  it('reflects a model change back into the checkbox', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const toggle = document.querySelector('[data-rn="switch"]') as HTMLInputElement;

    app.on.set(true);
    appRef.tick();

    assert.equal(toggle.checked, true);

    componentRef.destroy();
  });
});

describe('a disabled <text pressable>', () => {
  it('writes aria-disabled while disabled, and removes it once enabled', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const text = document.querySelector('[data-testid="terms"]') as HTMLElement;

    assert.equal(text.getAttribute('aria-disabled'), 'true');

    app.off.set(false);
    appRef.tick();
    assert.equal(text.getAttribute('aria-disabled'), null);

    app.off.set(true);
    appRef.tick();
    assert.equal(text.getAttribute('aria-disabled'), 'true');

    componentRef.destroy();
  });
});

describe('disabled and aria-disabled disagreeing', () => {
  it('writes the aria-disabled that disabled says, both ways', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const nodes = ['wins', 'own'].map(
      (id) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement,
    );
    for (const node of nodes) assert.equal(node.getAttribute('aria-disabled'), 'true');

    app.off.set(false);
    appRef.tick();
    for (const node of nodes) assert.equal(node.getAttribute('aria-disabled'), null);

    app.off.set(true);
    appRef.tick();
    for (const node of nodes) assert.equal(node.getAttribute('aria-disabled'), 'true');

    componentRef.destroy();
  });
});

describe('a <text pressable> is a link', () => {
  it('has role="link" while it can be pressed, and none while disabled', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapControls();
    const text = document.querySelector('[data-testid="wins"]') as HTMLElement;
    assert.equal(text.getAttribute('role'), null);

    app.off.set(false);
    appRef.tick();
    assert.equal(text.getAttribute('role'), 'link');

    app.off.set(true);
    appRef.tick();
    assert.equal(text.getAttribute('role'), null);

    componentRef.destroy();
  });
});

describe("image-background's node.props['style'] mirror", () => {
  it("copies the outer view's width/height onto the absolutely-filled inner image", async () => {
    const { document, componentRef } = await bootstrapControls();
    const outer = document.querySelector('image-background') as HTMLElement;
    const inner = outer.querySelector('[data-rn="image"]') as HTMLElement;

    assert.equal(outer.style.width, '120px');
    assert.equal(outer.style.height, '80px');

    // `ImageBackground.fill()` reads `this.node.props['style']` for the outer node's width and
    // height and copies them onto the inner image's own `[style]` - this only reads back 120/80
    // rather than `undefined` if `browser-renderer.ts`'s style mirror stayed in sync with the
    // two `setStyle` calls the two `[style.width.px]`/`[style.height.px]` bindings made above.
    assert.equal(inner.style.width, '120px');
    assert.equal(inner.style.height, '80px');
    assert.equal(
      inner.style.position,
      'absolute',
      "the rest of fill()'s object, unaffected by the mirror",
    );

    componentRef.destroy();
  });
});
