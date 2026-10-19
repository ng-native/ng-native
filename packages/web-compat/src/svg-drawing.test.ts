/**
 * A drawing a library writes in its template, builds from markup or makes from script: drawn by
 * react-native-svg's native views, named and placed as SVG has them, and measured for a script.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, Renderer2, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Engine, registerPlatformComponents } from '@ng-native/fabric';
import {
  cleanup,
  compileCss,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { textWidth } from './text-width.ts';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** How the build compiles a library's sheet, where a shape's paint is kept: see `compileCss`. */
const LIBRARY = { generated: true } as object;

@Component({
  selector: 'x-card',
  imports: [Text, View],
  template: `
    <view class="card" testID="card" data-kind="a">
      <view class="row first"><text>One</text></view>
      <view class="row" id="second"><text>Two</text></view>
    </view>
  `,
})
class Card {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly renderer = inject(Renderer2);
}

const mount = async () => {
  const app = await render(Card, { providers: [provideWebCompat()] });
  const host = app.instance.host;
  return { app, host, card: host.querySelector('.card') as Dom };
};

describe('@ng-native/web-compat markup', () => {
  it('hands an icon component an empty box for the markup it sets, and sends none of it', async () => {
    const { app, card } = await mount();
    const renderer = app.instance.renderer;
    // What `@ng-icons/core` does with an icon's SVG.
    const template = renderer.createElement('template');
    renderer.setProperty(template, 'innerHTML', '<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>');
    const svg = template.content.firstElementChild;
    assert.equal(template.content.firstElementChild, svg, 'the same box each time it is asked');
    renderer.appendChild(card, svg);
    await settle();
    assert.equal(template.props.innerHTML, undefined);
    assert.equal(svg.parentNode, card);
    assert.equal(svg.children.length, 0);
  });

  it("keeps a drawing's attributes on a copy of it, as cloneNode does", async () => {
    const { host } = await mount();
    host.innerHTML =
      `<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 4 4">` +
      `<path d="M0 0 L1 1" stroke="red"></path></svg>`;
    const copy = host.querySelector('svg').cloneNode(true);
    const attr = copy.attributes[0];
    assert.deepEqual(
      [attr?.name, attr?.namespaceURI, attr?.value],
      ['xmlns:xlink', 'http://www.w3.org/2000/xmlns/', 'http://www.w3.org/1999/xlink'],
    );
    assert.equal(copy.getAttribute('viewBox'), '0 0 4 4');
    assert.deepEqual(
      [copy.firstChild.getAttribute('d'), copy.firstChild.getAttribute('stroke')],
      ['M0 0 L1 1', 'red'],
    );
  });

  it('builds other markup a <template> is bound to, as a browser does', async () => {
    const { app } = await mount();
    const template = app.instance.renderer.createElement('template');
    app.instance.renderer.setProperty(template, 'innerHTML', '<p class="row">One</p>');
    assert.equal(template.content.firstElementChild.className, 'row');
    assert.equal(template.content.firstElementChild.textContent, 'One');
  });
});

@Component({
  selector: 'x-drawing',
  template: `
    <svg testID="svg" class="tick" [attr.viewBox]="box()" width="24" focusable="false">
      <path testID="path" class="mark" fill="none" [attr.stroke]="ink()" d="M1 2 3 4" />
      <circle testID="circle" cx="5" cy="6" r="7" />
    </svg>
  `,
})
class Drawing {
  readonly box = signal('0 0 24 24');
  readonly ink = signal<string | null>('currentColor');
}

@Component({
  selector: 'x-dial',
  template: `
    <svg viewBox="0 0 100 100">
      <text testID="value" [attr.x]="50" [attr.y]="57" text-anchor="middle" fill="red">
        {{ value() }}
      </text>
    </svg>
  `,
})
class Dial {
  readonly value = signal(42);
}

@Component({
  selector: 'x-sized-icon',
  styles: `
    .icon {
      width: 16px;
      height: 16px;
    }
  `,
  template: `
    <svg testID="styled" class="icon" width="14" height="14" viewBox="0 0 14 14"></svg>
    <svg testID="plain" width="14" height="14" viewBox="0 0 14 14"></svg>
  `,
})
class SizedIcon {}

@Component({
  selector: 'x-themed-text',
  template: `
    <div class="chart">
      <svg viewBox="0 0 100 100"><text testID="label" x="10" y="20">2020</text></svg>
    </div>
  `,
})
class ThemedText {}

@Component({
  selector: 'x-paged-text',
  template: `
    <div class="page">
      <svg viewBox="0 0 100 100">
        <g font-size="20"><text>2020</text></g>
        <text font-size="20">2020</text>
      </svg>
    </div>
  `,
})
class PagedText {}

@Component({
  selector: 'x-grouped-text',
  template: `
    <div class="chart">
      <svg viewBox="0 0 100 100">
        <g><text testID="grouped" x="10" y="20">2020</text></g>
      </svg>
    </div>
  `,
})
class GroupedText {}

@Component({
  selector: 'x-card-shape',
  template: `<svg viewBox="0 0 100 100">
    <rect testID="card" class="card" width="80" height="50" />
  </svg>`,
})
class CardShape {}

@Component({
  selector: 'x-styled-text',
  template: `
    <div class="chart">
      <svg viewBox="0 0 100 100">
        <text testID="styled" x="10" y="20" [style.fill]="ink()">40</text>
      </svg>
    </div>
  `,
})
class StyledText {
  readonly ink = signal<string | null>('rgb(24, 33, 46)');
}

describe('@ng-native/web-compat svg by element name', () => {
  it("is styled by a rule for its element's name, as a chart's text is themed", async () => {
    await render(ThemedText, { providers: [provideWebCompat()] });
    // As a library's sheet themes its chart's text, written into the page.
    const document = (globalThis as unknown as { document: Dom }).document;
    const sheet = document.createElement('style');
    sheet.textContent = '.chart text { fill: rgb(200, 200, 208); }';
    document.head.appendChild(sheet);
    await settle();
    assert.deepEqual(screen.getByTestId('label').props['fill'], {
      type: 0,
      payload: 'rgb(200, 200, 208)',
    });
    // One a script makes, as a chart library makes its labels.
    const made = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    made.setAttribute('testID', 'made');
    made.textContent = '2021';
    document.querySelector('svg')!.appendChild(made);
    await settle();
    assert.deepEqual(screen.getByTestId('made').props['fill'], {
      type: 0,
      payload: 'rgb(200, 200, 208)',
    });
  });
});

@Component({
  selector: 'x-foreign-label',
  template: `
    <svg viewBox="0 0 200 100">
      <foreignObject testID="foreign" x="10" y="20" width="120" height="40">
        <p testID="caption">Germany</p>
      </foreignObject>
    </svg>
  `,
})
class ForeignLabel {}

describe('@ng-native/web-compat svg foreignObject', () => {
  it('draws the HTML it holds where it says in the drawing, as a card label is', async () => {
    await render(ForeignLabel, { providers: [provideWebCompat()] });
    await settle();
    const foreign = screen.getByTestId('foreign');
    assert.equal(foreign.viewName, 'RNSVGForeignObject');
    const { x, y, width, height } = foreign.props;
    assert.deepEqual([x, y, width, height].map(String), ['10', '20', '120', '40']);
    assert.ok(screen.getByText('Germany'));
  });
});

describe('@ng-native/web-compat svg paint from a sheet', () => {
  it('follows the system from dark to light, back to the fill it starts with', async () => {
    const app = await render(ThemedText, {
      providers: [provideWebCompat()],
      conditions: { width: 400, height: 800, colorScheme: 'dark' },
      globalStyles: compileCss(
        '@media (prefers-color-scheme: dark) { .chart text { fill: rgb(200, 200, 208) } }',
        'global',
        LIBRARY,
      ) as never,
    });
    await settle();
    const fill = () => (screen.getByTestId('label').props['fill'] as { payload: unknown }).payload;
    assert.equal(fill(), 'rgb(200, 200, 208)');
    const engine = app.componentRef.injector.get(Engine);
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    await settle();
    assert.equal(fill(), 'black');
  });

  it('stops naming a paint the sheet no longer gives, for the group above to give it', async () => {
    const app = await render(GroupedText, {
      providers: [provideWebCompat()],
      conditions: { width: 400, height: 800, colorScheme: 'dark' },
      globalStyles: compileCss(
        '@media (prefers-color-scheme: dark) { .chart text { fill: rgb(200, 200, 208) } }',
        'global',
        LIBRARY,
      ) as never,
    });
    await settle();
    const label = () => screen.getByTestId('grouped').props;
    assert.ok((label()['propList'] as string[]).includes('fill'));
    app.componentRef.injector
      .get(Engine)
      .updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    await settle();
    // From the group, which the drawing fills black, as it was before the sheet said.
    assert.equal(label()['fill'] ?? null, null);
    // Still a list, and one with a name in it: react-native-svg keeps the list it had where it
    // is sent none, on Android, or an empty one, on iOS, and the text kept its own dark fill.
    const named = label()['propList'] as string[];
    assert.ok(named.length > 0 && !named.includes('fill'));
  });

  it("draws a text's words in its own style's fill, over a rule's for texts", async () => {
    const app = await render(StyledText, {
      providers: [provideWebCompat()],
      globalStyles: compileCss('.chart text { fill: rgb(200, 200, 208) }', 'global', {
        ...LIBRARY,
      }) as never,
    });
    await settle();
    // The span the words are drawn by, which would take the rule's fill from the cascade.
    const words = () => screen.getByTestId('styled').children[0]!.props['fill'];
    assert.deepEqual(words(), { type: 0, payload: 'rgb(24, 33, 46)' });
    app.fixture.componentInstance.ink.set(null);
    await settle();
    assert.deepEqual(words(), { type: 0, payload: 'rgb(200, 200, 208)' });
  });

  it("draws a text's words in the colour its own style's token says, as Highcharts styles a label", async () => {
    await render(StyledText, {
      providers: [provideWebCompat()],
      globalStyles: compileCss('.chart { --ink: rgb(10, 20, 30) }', 'global', {
        ...LIBRARY,
      }) as never,
    });
    await settle();
    const page = (globalThis as unknown as { document: Document }).document;
    const label = page.querySelector('text') as unknown as { style: Record<string, string> };
    label.style['fill'] = 'var(--ink)';
    await settle();
    const text = screen.getByTestId('styled');
    // A token is the cascade's to settle: a native text has no colour named var(--ink), and
    // Android stops the app on a brush with no colour in it.
    for (const drawn of [text, text.children[0]!])
      assert.deepEqual(drawn.props['fill'], { type: 0, payload: 'rgb(10, 20, 30)' });
  });

  it('draws no box of a sheet on a shape, as a browser draws none', async () => {
    await render(CardShape, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(
        '.card { background-color: white; padding: 14px; border-radius: 10px; border-width: 1px; margin: 4px; box-shadow: 0 1px 2px black; fill: red }',
        'global',
        LIBRARY,
      ) as never,
    });
    await settle();
    const card = screen.getByTestId('card').props;
    const box = Object.keys(card).filter((key) =>
      /^(background|border|padding|margin|boxShadow)/.test(key),
    );
    // A view's background over the drawing hid the shape and all drawn after it.
    assert.deepEqual(box, []);
    assert.deepEqual(card['fill'], { type: 0, payload: 'rgb(255, 0, 0)' });
  });
});

@Component({
  selector: 'x-schemed',
  template: `
    <svg viewBox="0 0 2 2">
      <path testID="schemed" fill="light-dark(rgb(1, 2, 3), rgb(4, 5, 6))" d="M0 0" />
    </svg>
  `,
})
class Schemed {}

@Component({
  selector: 'x-not-asking',
  template: `<svg testID="plain-svg"><text testID="plain-text">Hi</text></svg>`,
})
class NotAsking {}

describe('@ng-native/web-compat svg light-dark', () => {
  it("paints a shape with the side of a light-dark() for the app's scheme, and again as it changes", async () => {
    const app = await render(Schemed, {
      providers: [provideWebCompat()],
      conditions: { width: 400, height: 800, colorScheme: 'dark' },
    });
    await settle();
    const fill = () => screen.getByTestId('schemed').props['fill'];
    assert.deepEqual(fill(), { type: 0, payload: 'rgb(4, 5, 6)' });
    const engine = app.componentRef.injector.get(Engine);
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    await settle();
    assert.deepEqual(fill(), { type: 0, payload: 'rgb(1, 2, 3)' });
  });

  it("leaves another app's svg its own, beside one that asked for the package", async () => {
    await render(Schemed, { providers: [provideWebCompat()] });
    await render(NotAsking);
    await settle();
    // Not the drawing's text, which is a react-native-svg view.
    assert.notEqual(screen.getByTestId('plain-text').viewName, 'RNSVGText');
  });
});

describe('@ng-native/web-compat svg size', () => {
  it('is the size a stylesheet gives it, over its own width and height', async () => {
    // An icon's `width="14"` is its size where nothing else says, and under a rule that does.
    await render(SizedIcon, { providers: [provideWebCompat()] });
    await settle();
    const size = (id: string) => {
      const { width, height } = screen.getByTestId(id).props;
      return [width, height];
    };
    assert.deepEqual(size('styled'), [16, 16]);
    assert.deepEqual(size('plain'), [14, 14]);
  });
});

describe('@ng-native/web-compat svg text', () => {
  it("is the drawing's own text where it is written in one, at the place it is given", async () => {
    const said: unknown[] = [];
    const error = console.error;
    console.error = (...all: unknown[]) => said.push(all);
    try {
      const app = await render(Dial, { providers: [provideWebCompat()] });
      await settle();
      const value = screen.getByTestId('value');
      // A text and the span of it that holds what it says, as the native views have them.
      assert.equal(value.viewName, 'RNSVGText');
      const span = () => screen.getByTestId('value').children[0]!;
      assert.equal(span().viewName, 'RNSVGTSpan');
      assert.equal(span().props['content'], '42');
      assert.deepEqual([value.props['x'], value.props['y']], [['50'], ['57']]);
      assert.deepEqual(value.props['font'], { textAnchor: 'middle' });
      assert.deepEqual(value.props['fill'], { type: 0, payload: 'red' });
      app.fixture.componentInstance.value.set(7);
      await settle();
      assert.equal(span().props['content'], '7');
      assert.equal(screen.getByTestId('value').children.length, 1);
      assert.deepEqual(said, [], 'and is not taken for the text element of an app');
    } finally {
      console.error = error;
    }
  });
});

@Component({
  selector: 'x-clipped',
  styles: `
    .inked {
      --ink: rgb(1, 2, 3);
    }
  `,
  template: `
    <svg class="inked" viewBox="0 0 14 14">
      <path testID="inked" fill="var(--ink)" [attr.stroke]="line()" d="M1 2 3 4" />
    </svg>
    <svg viewBox="0 0 14 14">
      <g clip-path="url(#clip)">
        <path testID="themed" fill="var(--ink)" d="M1 2 3 4" />
      </g>
      <defs testID="defs">
        <clipPath testID="clip" id="clip"><rect width="14" height="14" fill="white" /></clipPath>
        <mask testID="mask" id="mask"><rect width="14" height="14" fill="white" /></mask>
      </defs>
    </svg>
    <table>
      <colgroup testID="columns">
        <col testID="column" />
      </colgroup>
      <tbody>
        <tr>
          <td>One</td>
        </tr>
      </tbody>
    </table>
  `,
})
class Clipped {
  readonly line = signal<string | null>('var(--ink)');
}

describe('@ng-native/web-compat svg definitions', () => {
  it('draws what an icon keeps in its definitions with the native views for them', async () => {
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(screen.getByTestId('defs').viewName, 'RNSVGDefs');
    assert.equal(screen.getByTestId('clip').viewName, 'RNSVGClipPath');
    assert.equal(screen.getByTestId('clip').props['name'], 'clip');
    assert.equal(screen.getByTestId('mask').viewName, 'RNSVGMask');
  });

  it('paints a shape with the token its fill names, where the token is set', async () => {
    // A library hands a shape its colours as the tokens of its theme.
    const app = await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const inked = () => screen.getByTestId('inked').props;
    assert.deepEqual(inked()['fill'], { type: 0, payload: 'rgb(1, 2, 3)' });
    assert.deepEqual(inked()['stroke'], { type: 0, payload: 'rgb(1, 2, 3)' });
    assert.deepEqual([...(inked()['propList'] as string[])].sort(), ['fill', 'stroke']);
    // And with what the attribute is next: a colour of its own, or none.
    app.fixture.componentInstance.line.set('red');
    await settle();
    assert.deepEqual(inked()['stroke'], { type: 0, payload: 'red' });
    app.fixture.componentInstance.line.set(null);
    await settle();
    assert.equal(inked()['stroke'] ?? null, null);
  });

  it('gives a shape no brush with nothing in it where the token is not set', async () => {
    // A brush with no colour in it is one the native view throws on.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const fill = screen.getByTestId('themed').props['fill'] as { payload?: unknown } | undefined;
    assert.ok(fill == null || fill.payload != null || (fill as { type: number }).type === 2);
  });

  it('sets the tokens a style made while the app runs gives the root, until it leaves', async () => {
    // A charting library writes its palette as tokens of the root, and paints by their names.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const themed = () => screen.getByTestId('themed').props['fill'] as { payload?: unknown };
    const style = document.createElement('style');
    style.textContent = ':root { --ink: #010203; --other: 4px }';
    document.head.appendChild(style);
    await settle();
    assert.equal(themed()?.payload, '#010203');
    style.remove();
    await settle();
    assert.equal(themed()?.payload ?? null, null);
  });

  it('paints a shape with a mix of a token, as Highcharts brightens a colour of its palette', async () => {
    // Told it may, Highcharts brightens `var(--highcharts-color-3)` for a sunburst's outer ring
    // and for a point under the finger as a color-mix() of it.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const style = document.createElement('style');
    style.textContent = ':root { --label: rgb(0, 0, 0) }';
    document.head.appendChild(style);
    const path: Dom = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('testID', 'mixed');
    path.setAttribute('d', 'M0 0 L1 1');
    path.setAttribute('fill', 'color-mix(in srgb, var(--label), white 50%)');
    path.setAttribute('stroke', 'color-mix(in srgb, rgb(0, 0, 0), white 50%)');
    const text: Dom = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('testID', 'mixed-label');
    text.textContent = 'Tokyo';
    text.style.fill = 'color-mix(in srgb, var(--label), white 50%)';
    const drawing = document.querySelector('svg')!;
    drawing.append(path, text);
    await settle();
    try {
      const paint = (id: string, key = 'fill') =>
        (screen.getByTestId(id).props[key] as Dom)?.payload;
      assert.equal(paint('mixed'), 'rgb(128, 128, 128)');
      assert.equal(paint('mixed', 'stroke'), 'rgb(128, 128, 128)');
      assert.equal(paint('mixed-label'), 'rgb(128, 128, 128)');
    } finally {
      style.remove();
    }
  });

  it('gives a styled text no brush with nothing in it where its fill is no colour native reads', async () => {
    // React Native's processColor answers nothing for what it cannot read, and a solid brush
    // with no colour in it stops the app on iOS.
    const readable = /^(#|rgb|hsl)|^[a-z]+$/i;
    const { fabric } = await render(Clipped, {
      providers: [provideWebCompat()],
      processColor: (value) =>
        typeof value !== 'string' || readable.test(value) ? value : undefined,
    });
    await settle();
    const text: Dom = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.textContent = 'Tokyo';
    text.style.fill = 'color-mix(in srgb, red 50%, blue)';
    document.querySelector('svg')!.appendChild(text);
    await settle();
    const empty: string[] = [];
    const walk = (node: Dom) => {
      for (const key of ['fill', 'stroke']) {
        const brush = node.props[key];
        if (brush?.type === 0 && brush.payload == null) empty.push(`${node.viewName} ${key}`);
      }
      node.children.forEach(walk);
    };
    fabric.committed.forEach(walk);
    assert.deepEqual(empty, []);
  });

  it('leaves out a view box of no size, and answers a drawing its attributes', async () => {
    // A library that animates a chart's size reads the width back to write the view box.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const drawing = document.querySelector('.inked')!;
    drawing.setAttribute('width', '340');
    assert.equal(drawing.getAttribute('width'), '340');
    drawing.setAttribute('viewBox', '0 0 0 0');
    await settle();
    assert.equal(
      (drawing as unknown as { props: Record<string, unknown> }).props['vbWidth'],
      undefined,
    );
    drawing.setAttribute('viewBox', '0 0 340 300');
    await settle();
    assert.equal((drawing as unknown as { props: Record<string, unknown> }).props['vbWidth'], 340);
  });

  it('answers a script what a shape it made is: its name, its kind and its box', async () => {
    // A chart library builds its drawing from script, and lays a label out by what it is told.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('.inked')!;
    const label = document.createElementNS(SVG, 'text') as SVGTextElement;
    label.setAttribute('x', '10');
    label.setAttribute('y', '20');
    label.style.fontSize = '0.5em';
    label.appendChild(document.createTextNode('Spain'));
    drawing.appendChild(label);
    const group = document.createElementNS(SVG, 'g') as SVGGElement;
    group.setAttribute('class', 'series');
    const bar = document.createElementNS(SVG, 'rect') as SVGRectElement;
    for (const [name, value] of Object.entries({ x: 2, y: 3, width: 4, height: 5 })) {
      bar.setAttribute(name, String(value));
    }
    bar.setAttribute('transform', 'translate(10, 0)');
    group.appendChild(bar);
    drawing.appendChild(group);
    await settle();
    assert.deepEqual([label.nodeName, label.namespaceURI, label.nodeType], ['text', SVG, 1]);
    assert.deepEqual(
      [label.firstChild!.nodeType, document.body.namespaceURI],
      [3, 'http://www.w3.org/1999/xhtml'],
    );
    assert.equal(group.className.baseVal, 'series');
    assert.ok(document.body.contains(label));
    // A font size as a share of the one around it is set in points, and the box is by it.
    const engineLabel = label as unknown as {
      props: Record<string, { fontSize?: unknown }>;
      viewName?: string;
    };
    assert.equal(String(engineLabel.props['font']!.fontSize), '8');
    // And is the size its spans inherit, which native reads over the text's own.
    assert.equal((engineLabel.props['style'] as { fontSize?: unknown }).fontSize, 8);
    assert.equal(getComputedStyle(label).getPropertyValue('font-size'), '8px');
    assert.equal(getComputedStyle(label).fontSize, '8px');
    const box = label.getBBox();
    assert.ok(
      box.width > 15 && box.width < 25 && box.x === 10 && box.height > 8,
      JSON.stringify(box),
    );
    assert.ok(label.getComputedTextLength() === box.width);
    assert.deepEqual({ ...group.getBBox() }, { x: 12, y: 3, width: 4, height: 5 });
    // A shape a script hides is not drawn, and is again once it is shown.
    group.setAttribute('visibility', 'hidden');
    await settle();
    const shown = () => (group as unknown as { committed: unknown }).committed != null;
    assert.equal(shown(), false);
    // Shown by taking the attribute off, which is how a library says a shape is as its group is.
    assert.equal(group.hasAttribute('visibility'), true);
    group.removeAttribute('visibility');
    await settle();
    assert.deepEqual([shown(), group.hasAttribute('visibility')], [true, false]);
    // And is found by the name SVG gives it, which is how a library finds a line break it wrote.
    const broken = document.createElementNS(SVG, 'tspan');
    broken.setAttribute('class', 'br');
    label.appendChild(broken);
    assert.equal(drawing.querySelector('text'), label);
    assert.deepEqual([...label.querySelectorAll('tspan.br')], [broken]);
    broken.remove();
    // A text along a path: the path is named by its id, and the text refers to it by that.
    const curve = document.createElementNS(SVG, 'path');
    curve.setAttribute('id', 'curve');
    curve.setAttribute('d', 'M0 0 C 5 5 10 5 15 0');
    drawing.appendChild(curve);
    const along = document.createElementNS(SVG, 'textPath');
    along.setAttribute('href', '#curve');
    along.setAttribute('startOffset', '50%');
    along.appendChild(document.createTextNode('Round'));
    const curved = document.createElementNS(SVG, 'text');
    curved.appendChild(along);
    drawing.appendChild(curved);
    await settle();
    type Committed = { committed?: { viewName: string; props: Record<string, unknown> } };
    const view = (node: unknown) => (node as Committed).committed!;
    assert.equal(view(curve).props['name'], 'curve');
    assert.equal(view(along).viewName, 'RNSVGTextPath');
    assert.deepEqual(
      [view(along).props['href'], view(along).props['startOffset']],
      ['curve', '50%'],
    );
    assert.equal((along as unknown as SVGElement).className.baseVal, '');
    const round = (along.firstChild as unknown as { box: Committed }).box.committed!;
    assert.deepEqual([round.viewName, round.props['content']], ['RNSVGTSpan', 'Round']);
    // Its words are a span of the text, which is what the native text draws, and stay its words.
    type Span = { committed?: { viewName: string; props: Record<string, unknown> } };
    const span = () => (label.firstChild as unknown as { box: Span }).box.committed!;
    assert.deepEqual([span().viewName, span().props['content']], ['RNSVGTSpan', 'Spain']);
    label.firstChild!.textContent = 'Italy';
    await settle();
    assert.equal(span().props['content'], 'Italy');
  });

  it("measures a text at the size a sheet's rule gives it, as it is drawn", async () => {
    await render(ThemedText, {
      providers: [provideWebCompat()],
      globalStyles: compileCss('.chart text { font-size: 32px }', 'global', LIBRARY) as never,
    });
    await settle();
    const label: Dom = document.querySelector('text');
    const sized: Dom = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sized.setAttribute('font-size', '32');
    sized.textContent = '2020';
    document.querySelector('svg')!.append(sized);
    await settle();
    assert.equal(label.getComputedTextLength(), sized.getComputedTextLength());
  });

  it("measures a text by its group's size over the page's, which a sheet gives the HTML above", async () => {
    await render(PagedText, {
      providers: [provideWebCompat()],
      globalStyles: compileCss('.page { font-size: 10px }', 'global', LIBRARY) as never,
    });
    await settle();
    const [grouped, own]: Dom[] = [...document.querySelectorAll('text')];
    assert.equal(grouped.getComputedTextLength(), own.getComputedTextLength());
  });

  it("measures a text as Chrome does, by its size and its weight, a style's or one above it", async () => {
    // Highcharts turns axis labels, cuts a label short and sizes a pie by these widths.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const group: Dom = document.createElementNS(SVG, 'g');
    group.setAttribute('font-weight', 'bold');
    const title: Dom = document.createElementNS(SVG, 'text');
    title.setAttribute('font-size', '19.2');
    title.textContent = 'Where time goes';
    const plain: Dom = document.createElementNS(SVG, 'text');
    plain.style.fontSize = '12.8px';
    plain.textContent = 'Monthly temperature';
    group.appendChild(title);
    document.querySelector('svg')!.append(group, plain);
    await settle();
    // Chrome's, on a Mac, where the font is the one iOS draws in.
    const near = (width: number, chrome: number) =>
      assert.ok(Math.abs(width / chrome - 1) < 0.01, `${width} is not near ${chrome}`);
    near(title.getComputedTextLength(), 153.64);
    near(plain.getBBox().width, 125.25);
    // And as tall, from as far over its baseline, which a title's height leaves the plot under.
    plain.setAttribute('y', '100');
    const { y, height } = plain.getBBox();
    assert.ok(Math.abs(y - 88) < 0.5 && Math.abs(height - 15) < 0.5, JSON.stringify({ y, height }));
    // Chrome rounds each to whole pixels, which a title's height moves the plot by.
    title.setAttribute('y', '25');
    assert.deepEqual([title.getBBox().y, title.getBBox().height], [6, 23]);
    plain.setAttribute('dominant-baseline', 'middle');
    const middle = plain.getBBox();
    assert.ok(Math.abs(middle.y - 91) < 0.5, JSON.stringify(middle));
  });

  it('measures each span of a text by its own font, and its lines by where they are set', async () => {
    // A Highcharts tooltip: a small first line, then a bullet, words and a bold value. Measured
    // all at the text's size and weight, the box was narrower and taller than its words.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('svg')!;
    const tip: Dom = document.createElementNS(SVG, 'text');
    tip.setAttribute('x', '8');
    tip.setAttribute('y', '18');
    tip.style.fontSize = '12.8px';
    // Styled as Highcharts styles a span, a property at a time.
    const span = (words: string, style: Record<string, string> = {}): Dom => {
      const made: Dom = document.createElementNS(SVG, 'tspan');
      Object.assign(made.style, style);
      made.textContent = words;
      return made;
    };
    const breaks = span('\u200b');
    breaks.setAttribute('x', '8');
    breaks.setAttribute('dy', '15');
    // Put in one at a time, as Highcharts puts them.
    for (const part of [span('Jul', { fontSize: '0.8em' }), breaks, span('\u25cf')]) {
      tip.appendChild(part);
    }
    tip.appendChild(document.createTextNode(' Tokyo: '));
    tip.appendChild(span('25', { fontWeight: 'bold' }));
    const plain: Dom = document.createElementNS(SVG, 'text');
    plain.setAttribute('y', '40');
    plain.style.fontSize = '12px';
    plain.appendChild(document.createTextNode('Plain '));
    plain.appendChild(span('Big', { fontWeight: 'bold', fontSize: '20px' }));
    drawing.append(tip, plain);
    await settle();
    // Chrome's, on a Mac, in the stack Highcharts writes.
    const near = (box: { x: number; y: number; width: number; height: number }, chrome: number[]) =>
      assert.ok(
        [box.x, box.y, box.width, box.height].every((v, i) => Math.abs(v - chrome[i]!) < 0.4),
        `${JSON.stringify(box)} is not near ${JSON.stringify(chrome)}`,
      );
    near(tip.getBBox(), [8, 8, 74.58, 28]);
    near(plain.getBBox(), [0, 21, 61.08, 23]);
  });

  it('anchors a text by the path it is set along, as a sunburst centres its labels on an arc', async () => {
    // Native reads where the words sit against their place from the text, and a path passes
    // what it is given over: Highcharts writes text-anchor on the path, and its labels started
    // half way along their arcs and ran off the end.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('svg')!;
    const along: Dom = document.createElementNS(SVG, 'textPath');
    along.setAttribute('text-anchor', 'middle');
    along.appendChild(document.createTextNode('Games'));
    const text: Dom = document.createElementNS(SVG, 'text');
    text.setAttribute('font-size', '11');
    text.appendChild(along);
    drawing.appendChild(text);
    await settle();
    const font = () => (text as { committed: { props: Dom } }).committed.props['font'] ?? {};
    assert.deepEqual(font(), { fontSize: '11', textAnchor: 'middle' });
    along.setAttribute('text-anchor', 'end');
    await settle();
    assert.equal(font().textAnchor, 'end');
    text.setAttribute('font-size', '12');
    await settle();
    assert.deepEqual(font(), { fontSize: '12', textAnchor: 'end' }, 'kept as the text changes');
    // A copy of its words under them, its outline, is drawn along the path too: see below.
    const copy: Dom = document.createElementNS(SVG, 'tspan');
    copy.setAttribute('stroke', 'white');
    copy.appendChild(document.createTextNode('Games'));
    const back: Dom = document.createElementNS(SVG, 'tspan');
    back.setAttribute('x', '0');
    back.textContent = '\u200b';
    copy.appendChild(back);
    along.insertBefore(copy, along.firstChild);
    await settle();
    assert.notEqual((copy as { committed?: unknown }).committed ?? null, null);
    along.remove();
    await settle();
    assert.equal(font().textAnchor, undefined, 'gone with the path');
  });

  it('sizes a text in em by the group it is put in, and again as that changes', async () => {
    // Highcharts styles a label 0.7em before it puts it in a group that is 0.7em itself.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const group: Dom = document.createElementNS(SVG, 'g');
    group.style.fontSize = '0.7em';
    document.querySelector('svg')!.appendChild(group);
    const label: Dom = document.createElementNS(SVG, 'text');
    label.style.fontSize = '0.7em';
    label.textContent = 'Polish';
    group.appendChild(label);
    await settle();
    const size = () => Number(label.getAttribute('font-size'));
    assert.ok(Math.abs(size() - 7.84) < 0.01, String(size()));
    group.style.fontSize = '1em';
    await settle();
    assert.ok(Math.abs(size() - 11.2) < 0.01, String(size()));
    label.remove();
    await settle();
    assert.ok(Math.abs(size() - 11.2) < 0.01, 'kept where it was put');
  });

  it('keeps the space at the end of a span that more words follow, as a timeline label has', async () => {
    // Highcharts writes `<span>● </span><span>1903</span>`: the space parts the dot and the year.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const label: Dom = document.createElementNS(SVG, 'text');
    const spans = ['  ●  ', '1903 '].map((words) => {
      const span: Dom = document.createElementNS(SVG, 'tspan');
      span.textContent = words;
      label.appendChild(span);
      return span;
    });
    document.querySelector('svg')!.appendChild(label);
    await settle();
    const content = (span: Dom) => span.committed.props['content'];
    // Spaces run together into one, and none is drawn before the first word or after the last.
    assert.deepEqual(spans.map(content), ['● ', '1903']);
    // And the year is no longer the last words once more follow it.
    const more: Dom = document.createElementNS(SVG, 'tspan');
    more.textContent = 'First';
    label.appendChild(more);
    await settle();
    assert.deepEqual([...spans, more].map(content), ['● ', '1903 ', 'First']);
    more.remove();
    await settle();
    assert.deepEqual(spans.map(content), ['● ', '1903']);
  });

  it('draws a copy under the words of a text as their outline, each set against the place', async () => {
    // A chart library outlines a label with a copy of its words in a stroked span, which ends
    // with a span that puts the place back where the text starts, the way Highcharts does.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('.inked')!;
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', '40');
    label.setAttribute('y', '20');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '10');
    label.appendChild(document.createTextNode('Greens'));
    drawing.appendChild(label);
    await settle();
    const alone = label.getBBox();
    const outline = document.createElementNS(SVG, 'tspan');
    outline.setAttribute('stroke', 'white');
    outline.setAttribute('stroke-width', '2');
    outline.appendChild(label.firstChild!.cloneNode(true));
    const back = document.createElementNS(SVG, 'tspan');
    back.textContent = '\u200b';
    back.setAttribute('x', '40');
    back.setAttribute('dy', '0');
    outline.appendChild(back);
    label.insertBefore(outline, label.firstChild);
    await settle();
    // Native draws a span's own words and nothing in it, so the place is not put back, and it
    // sets every span against the text's place by the width of all of them. The copy starts
    // over at the text's place, and the words are moved back by as much of the copy as was
    // counted against them: half of it, for a text set on its middle.
    type Committed = { committed?: { viewName: string; props: Record<string, unknown> } };
    const drawn = (node: unknown) => (node as Committed).committed!.props;
    const copy = textWidth('Greens', 10, 400);
    assert.deepEqual(drawn(outline)['x'], ['40']);
    assert.equal((drawn(outline)['stroke'] as Dom).payload, 'white');
    assert.deepEqual(drawn(label)['dx'], [0, 0, 0, 0, 0, 0, -copy / 2]);
    label.setAttribute('x', '50');
    label.setAttribute('text-anchor', 'start');
    await settle();
    assert.deepEqual(drawn(outline)['x'], ['50'], 'with the text as it moves');
    assert.deepEqual(drawn(label)['dx'], [0, 0, 0, 0, 0, 0, -copy]);
    // A text's own first dx, as Highcharts writes one on a label, is kept with it.
    label.setAttribute('dx', '2');
    await settle();
    assert.deepEqual(drawn(label)['dx'], [2, 0, 0, 0, 0, 0, -copy]);
    label.removeAttribute('dx');
    const words = (label.lastChild as unknown as { box: Committed }).box.committed!;
    assert.equal(words.props['content'], 'Greens');
    // And the box is that of the words, where the copy is drawn under them in a browser.
    label.setAttribute('x', '40');
    label.setAttribute('text-anchor', 'middle');
    assert.deepEqual({ ...label.getBBox() }, { ...alone });
    assert.equal(label.textContent, 'Greens\u200bGreens');
    // A copy of words in a span of their own is one line too; one of two lines is drawn a line
    // at a time: see below.
    const bold = document.createElementNS(SVG, 'tspan');
    bold.appendChild(outline.firstChild!);
    outline.insertBefore(bold, back);
    await settle();
    assert.deepEqual(drawn(label)['dx'], [0, 0, 0, 0, 0, 0, -copy / 2]);
    bold.setAttribute('dy', '12');
    await settle();
    assert.equal(drawn(outline)['content'], '');
    outline.remove();
    await settle();
    assert.deepEqual({ ...label.getBBox() }, { ...alone });
    assert.equal(drawn(label)['dx'], undefined, 'and the words are where they were');
  });

  it('draws a copy under words set along a path as their outline, set back along it', async () => {
    // A sunburst sets its labels along their arcs, each outlined by a copy in the path, as
    // Highcharts writes them. The copy was not drawn, and a label on a ring had no outline.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('.inked')!;
    const arc = document.createElementNS(SVG, 'path');
    arc.setAttribute('id', 'ring');
    arc.setAttribute('d', 'M 0 50 A 50 50 0 0 1 100 50');
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('font-size', '10');
    const along = document.createElementNS(SVG, 'textPath');
    along.setAttribute('href', '#ring');
    along.setAttribute('startOffset', '50%');
    along.setAttribute('text-anchor', 'middle');
    const outline = document.createElementNS(SVG, 'tspan');
    outline.setAttribute('stroke', 'black');
    outline.setAttribute('stroke-width', '2');
    outline.appendChild(document.createTextNode('Work'));
    const back = document.createElementNS(SVG, 'tspan');
    back.textContent = '\u200b';
    back.setAttribute('x', '0');
    back.setAttribute('dy', '0');
    outline.appendChild(back);
    along.appendChild(outline);
    along.appendChild(document.createTextNode('Work'));
    label.appendChild(along);
    drawing.append(arc, label);
    await settle();
    type Committed = { committed?: { viewName: string; props: Record<string, unknown> } };
    const drawn = (node: unknown) => (node as Committed).committed?.props;
    const copy = textWidth('Work', 10, 400);
    // Drawn, stroked, and not started over: along a path, a place is how far along it.
    assert.equal((drawn(outline)!['stroke'] as Dom).payload, 'black');
    assert.equal(drawn(outline)!['x'], undefined);
    // Native sets the copy and the words along the path as one run, centred on its middle: the
    // copy is moved on by half of itself, and the words back by all of it, to lie on it.
    assert.deepEqual(drawn(label)!['dx'], [copy / 2, 0, 0, 0, -copy]);
    along.setAttribute('text-anchor', 'start');
    await settle();
    assert.deepEqual(drawn(label)!['dx'], [0, 0, 0, 0, -copy]);
    along.setAttribute('text-anchor', 'end');
    await settle();
    assert.deepEqual(drawn(label)!['dx'], [copy, 0, 0, 0, -copy]);
    // A copy given other words, as Highcharts gives a label, is measured again, and one taken
    // out leaves the words where they were.
    outline.insertBefore(document.createTextNode('Rest!'), outline.firstChild);
    outline.firstChild!.nextSibling!.remove();
    await settle();
    const rest = textWidth('Rest!', 10, 400);
    assert.deepEqual(drawn(label)!['dx'], [rest, 0, 0, 0, 0, -rest]);
    outline.remove();
    await settle();
    assert.equal(drawn(label)!['dx'], undefined);
  });

  it('sets each line of a text on its middle by its own width, as a browser sets each chunk', async () => {
    // A data label of two lines, as Highcharts writes one for a format with a break: native sets
    // every line against the text's place by the width of all of them, and a second line was
    // drawn from where the first one started, off its middle.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('.inked')!;
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', '25');
    label.setAttribute('y', '12');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '11');
    const breaks = document.createElementNS(SVG, 'tspan');
    breaks.setAttribute('x', '25');
    breaks.setAttribute('dy', '14');
    breaks.textContent = '\u200b';
    label.appendChild(document.createTextNode('Chrome'));
    label.appendChild(breaks);
    label.appendChild(document.createTextNode('63'));
    drawing.appendChild(label);
    await settle();
    type Committed = { committed?: { props: Record<string, unknown> } };
    const dx = () => (label as unknown as Committed).committed!.props['dx'];
    const [first, second] = [textWidth('Chrome', 11, 400), textWidth('63', 11, 400)];
    const all = first + second + textWidth('\u200b', 11, 400);
    // Each line moved on by as much as native set it back for the others: the second from its
    // break, the glyph after the first line's six.
    assert.deepEqual(dx(), [(all - first) / 2, 0, 0, 0, 0, 0, (all - second) / 2]);
    label.setAttribute('text-anchor', 'end');
    await settle();
    assert.deepEqual(dx(), [all - first, 0, 0, 0, 0, 0, all - second]);
    // Set from its start, each line is where native puts it; and one line is left as it is.
    label.setAttribute('text-anchor', 'start');
    await settle();
    assert.equal(dx(), undefined);
    label.setAttribute('text-anchor', 'middle');
    breaks.remove();
    label.lastChild!.remove();
    await settle();
    assert.equal(dx(), undefined);
  });

  it('draws a copy of a label of two lines as its outline, a line at a time', async () => {
    // Highcharts outlines a data label of two lines with a copy of both, its break and a span
    // putting the place back. Native draws a span's own words or what is in it, never both, so
    // the copy was not drawn, and the label had no outline.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('.inked')!;
    const label = document.createElementNS(SVG, 'text');
    for (const [name, value] of Object.entries({ x: '25', y: '12', 'font-size': '11' })) {
      label.setAttribute(name, value);
    }
    label.setAttribute('text-anchor', 'middle');
    const span = (words: string, x: string, dy: string) => {
      const made = document.createElementNS(SVG, 'tspan');
      made.setAttribute('x', x);
      made.setAttribute('dy', dy);
      made.textContent = words;
      return made;
    };
    const copy = document.createElementNS(SVG, 'tspan');
    copy.setAttribute('stroke', 'white');
    copy.setAttribute('stroke-width', '2');
    const [breaks, back] = [span('\u200b', '25', '14'), span('\u200b', '25', '-14')];
    for (const part of [
      document.createTextNode('Chrome'),
      breaks,
      document.createTextNode('63'),
      back,
    ]) {
      copy.appendChild(part);
    }
    label.appendChild(copy);
    label.appendChild(document.createTextNode('Chrome'));
    label.appendChild(span('\u200b', '25', '14'));
    label.appendChild(document.createTextNode('63'));
    drawing.appendChild(label);
    await settle();
    type Committed = { committed?: { props: Record<string, unknown> } };
    const drawn = (node: unknown) => (node as Committed).committed?.props;
    // The copy draws what is in it: its first line in a span of the engine's own, set from the
    // text's place, and each line after in the span that breaks to it, each a place of its own.
    assert.equal(drawn(copy)!['content'], '', 'no words of its own, which native reads as none');
    assert.equal((drawn(copy)!['stroke'] as Dom).payload, 'white');
    assert.equal(drawn(breaks)!['content'], '\u200b63');
    assert.equal(drawn(back)!['content'], '\u200b');
    const first = fabricTextOf(copy);
    assert.deepEqual([first?.['content'], first?.['x']], ['Chrome', ['25']]);
    // A script reads the copy as it wrote it.
    assert.equal(copy.childNodes.length, 4);
    assert.equal(copy.textContent, 'Chrome\u200b63\u200b');
    // Native sets the words after the copy against the text's place by the width of both, so
    // each of their lines is moved on by as much as the others moved it back, from the copy's
    // ten letters on.
    const [one, two] = [textWidth('Chrome', 11, 400), textWidth('63', 11, 400)];
    const all = 2 * (one + two);
    const dx = drawn(label)!['dx'] as number[];
    assert.deepEqual(dx, [...Array(10).fill(0), (all - one) / 2, 0, 0, 0, 0, 0, (all - two) / 2]);
    // A copy of one line again is drawn as one, without the span the engine kept for it.
    breaks.remove();
    copy.childNodes[1]!.remove();
    await settle();
    assert.equal(drawn(copy)!['content'], 'Chrome');
    assert.equal(fabricTextOf(copy), undefined);
  });

  it('sets a text on its middle where it says, and answers its box from there', async () => {
    // A word cloud places each word by its middle, and packs the words by their boxes.
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const SVG = 'http://www.w3.org/2000/svg';
    const drawing = document.querySelector('.inked')!;
    const word = document.createElementNS(SVG, 'text');
    for (const [name, value] of Object.entries({ x: 0, y: 50, 'font-size': 20 })) {
      word.setAttribute(name, String(value));
    }
    word.appendChild(document.createTextNode('engine'));
    drawing.appendChild(word);
    await settle();
    const onBaseline = word.getBBox();
    word.setAttribute('dominant-baseline', 'middle');
    word.setAttribute('alignment-baseline', 'middle');
    await settle();
    type Committed = { committed?: { props: Record<string, unknown> } };
    assert.equal((word as unknown as Committed).committed!.props['alignmentBaseline'], 'middle');
    const middle = word.getBBox();
    // Its middle is that of its small letters, a little under the middle of its box, as in Chrome.
    assert.ok(Math.abs(middle.y - (50 - 0.58 * middle.height)) < 0.5, JSON.stringify(middle));
    assert.equal(middle.height, onBaseline.height);
    word.removeAttribute('alignment-baseline');
    await settle();
    // Either one says it: `dominant-baseline` is the one a browser reads for a text.
    assert.equal((word as unknown as Committed).committed!.props['alignmentBaseline'], 'middle');
    word.removeAttribute('dominant-baseline');
    await settle();
    assert.equal((word as unknown as Committed).committed!.props['alignmentBaseline'], undefined);
    assert.deepEqual({ ...word.getBBox() }, { ...onBaseline });
  });

  it('answers the drawing a shape is in, and a box of none it makes', async () => {
    await render(Clipped, { providers: [provideWebCompat()] });
    await settle();
    const drawing = document.querySelector('.inked') as SVGSVGElement;
    const shape = drawing.querySelector('path')!;
    assert.deepEqual([shape.ownerSVGElement, drawing.ownerSVGElement], [drawing, null]);
    assert.deepEqual({ ...drawing.createSVGRect() }, { x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('@ng-native/web-compat svg', () => {
  const draw = async () => {
    const app = await render(Drawing, { providers: [provideWebCompat()] });
    await settle();
    return app.fixture.componentInstance;
  };
  const sorted = (list: unknown) => [...(list as string[])].sort();

  it("is drawn by the native shapes, with the view box and the shapes' own paint", async () => {
    await draw();
    const svg = screen.getByTestId('svg');
    assert.equal(svg.viewName, 'RNSVGSvgView');
    assert.deepEqual(
      { ...svg.props, testID: undefined },
      {
        minX: 0,
        minY: 0,
        vbWidth: 24,
        vbHeight: 24,
        align: 'xMidYMid',
        meetOrSlice: 0,
        // The width the element gives, and the height its view box makes of it.
        width: 24,
        aspectRatio: 1,
        testID: undefined,
      },
    );
    const path = screen.getByTestId('path');
    assert.equal(path.viewName, 'RNSVGPath');
    assert.equal(path.props['d'], 'M1 2 3 4');
    assert.equal(path.props['fill'] ?? null, null);
    assert.deepEqual(path.props['stroke'], { type: 2 });
    assert.deepEqual(sorted(path.props['propList']), ['fill', 'stroke']);
    const circle = screen.getByTestId('circle');
    assert.equal(circle.viewName, 'RNSVGCircle');
    assert.deepEqual([circle.props['cx'], circle.props['cy'], circle.props['r']], ['5', '6', '7']);
  });

  it('is as wide as what holds it and as tall as its view box makes that, with no size said', async () => {
    const drawing = await draw();
    drawing.box.set('0 0 48 24');
    await settle();
    // The width the element gives is its own; the height follows the view box from it.
    assert.equal(screen.getByTestId('svg').props['aspectRatio'], 2);
    assert.equal(screen.getByTestId('svg').props['width'], 24);
  });

  it('follows an attribute that changes, and one that goes', async () => {
    const drawing = await draw();
    drawing.box.set('0 0 48 48');
    drawing.ink.set(null);
    await settle();
    assert.equal(screen.getByTestId('svg').props['vbWidth'], 48);
    const path = screen.getByTestId('path');
    assert.equal(path.props['stroke'] ?? null, null);
    assert.deepEqual(sorted(path.props['propList']), ['fill']);
  });
});

@Component({
  template: `
    <svg testID="drawing" viewBox="0 0 10 10">
      <g testID="group">
        <title>What a pointer over it is told</title>
        <path testID="shape" d="M0 0h10v10z" />
      </g>
    </svg>
  `,
})
class Drawings {}

describe('@ng-native/web-compat svg, as a browser starts one', () => {
  it('fills a shape with no fill of its own black, by what the drawing holds it in', async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    await settle();
    // On the group written straight into the drawing, which a shape in it takes its fill from.
    const group = screen.getByTestId('group');
    assert.deepEqual(group.props['fill'], { type: 0, payload: 'black' });
    assert.ok((group.props['propList'] as string[]).includes('fill'));
    assert.equal(screen.getByTestId('shape').props['fill'], undefined);
  });

  it('draws nothing for a title, which is what a pointer over a shape is told', async () => {
    const { error } = console;
    const said: string[] = [];
    console.error = (message: unknown) => void said.push(String(message));
    try {
      await render(Drawings, { providers: [provideWebCompat()] });
      await settle();
    } finally {
      console.error = error;
    }
    assert.deepEqual(said, []);
    assert.equal(screen.queryByText('What a pointer over it is told'), null);
  });
});

@Component({
  template: `
    <svg viewBox="0 0 10 10">
      <defs>
        <linearGradient id="fade" testID="fade">
          @for (stop of stops(); track stop.at) {
            <stop [attr.offset]="stop.at + '%'" [style.stop-color]="stop.colour" />
          }
        </linearGradient>
      </defs>
      <rect width="10" height="10" fill="url(#fade)" />
    </svg>
  `,
})
class Faded {
  readonly stops = signal([
    { at: 0, colour: 'red' },
    { at: 100, colour: 'blue' },
  ]);
}

describe('@ng-native/web-compat svg gradient, its stops made in a loop', () => {
  it('has the colours its stops are bound to, which are set after each is put in', async () => {
    const app = await render(Faded, { providers: [provideWebCompat()] });
    await settle();
    const list = () => screen.getByTestId('fade').props['gradient'];
    assert.deepEqual(list(), [0, 'red', 1, 'blue']);
    // And follows one that changes, and one that comes.
    app.instance.stops.set([
      { at: 0, colour: 'green' },
      { at: 50, colour: 'white' },
      { at: 100, colour: 'blue' },
    ]);
    await settle();
    await settle();
    assert.deepEqual(list(), [0, 'green', 0.5, 'white', 1, 'blue']);
    // And one that goes.
    app.instance.stops.set([{ at: 100, colour: 'blue' }]);
    await settle();
    await settle();
    assert.deepEqual(list(), [1, 'blue']);
  });

  it('follows the colour of a stop bound by its style alone', async () => {
    const app = await render(Faded, { providers: [provideWebCompat()] });
    await settle();
    const list = () => screen.getByTestId('fade').props['gradient'];
    app.instance.stops.set([
      { at: 0, colour: 'red' },
      { at: 100, colour: 'green' },
    ]);
    await settle();
    await settle();
    assert.deepEqual(list(), [0, 'red', 1, 'green']);
  });
});

@Component({
  template: `
    <svg viewBox="0 0 100 100">
      <g font-size="20">
        <text testID="sized" x="1" font-weight="bold" [style.font-size]="size()">Hi</text>
      </g>
      <filter id="shade">
        @if (shaded()) {
          <feDropShadow dx="1" dy="1" />
        }
      </filter>
    </svg>
  `,
})
class Bound {
  readonly size = signal('0.5em');
  readonly shaded = signal(true);
}

describe('@ng-native/web-compat svg, bound by a template', () => {
  it("sizes a text by a style bound in em, as a share of its group's size", async () => {
    const app = await render(Bound, { providers: [provideWebCompat()] });
    await settle();
    const font = () => screen.getByTestId('sized').props['font'] as Record<string, unknown>;
    assert.equal(font()['fontSize'], '10');
    app.instance.size.set('2em');
    await settle();
    assert.equal(font()['fontSize'], '40');
  });

  it('takes the steps of a shadow away with it, as a template takes it away', async () => {
    const app = await render(Bound, { providers: [provideWebCompat()] });
    await settle();
    const steps = () =>
      flatten(app.fabric.committed).filter((node) => node.viewName.startsWith('RNSVGFe')).length;
    assert.equal(steps(), 5);
    app.instance.shaded.set(false);
    await settle();
    assert.equal(steps(), 0);
  });

  it('answers the size of a text in pixels, from its own font size', async () => {
    await render(Bound, { providers: [provideWebCompat()] });
    await settle();
    const text = screen.getByTestId('sized').instanceHandle;
    assert.equal(globalThis.getComputedStyle(text as never).fontSize, '10px');
  });

  it('has none of the members of an HTML element, as an element of SVG has none', async () => {
    await render(Bound, { providers: [provideWebCompat()] });
    await settle();
    const text = screen.getByTestId('sized').instanceHandle as Dom;
    assert.deepEqual([text.title, text.dir], [undefined, undefined]);
  });
});

describe('@ng-native/web-compat svg in markup', () => {
  it('is a drawing, its text and its words as a template writes them', async () => {
    const { card } = await mount();
    card.innerHTML = '<svg viewBox="0 0 10 10"><text x="1" y="5">Hi</text></svg>';
    await settle();
    const text = card.querySelector('text');
    assert.deepEqual([text.namespaceURI, text.tagName], ['http://www.w3.org/2000/svg', 'text']);
    const view = screen.getByTestId('card').children.at(-1)!.children[0]!;
    assert.deepEqual(
      [view.viewName, view.children.map((each) => [each.viewName, each.props['content']])],
      ['RNSVGText', [['RNSVGTSpan', 'Hi']]],
    );
  });

  it("lists a shape's attributes as written, and those kept as its props", async () => {
    const { card } = await mount();
    card.innerHTML = '<svg viewBox="0 0 10 10"><path d="M0 0" data-kind="a" /></svg>';
    await settle();
    assert.deepEqual(card.querySelector('path').getAttributeNames().sort(), ['d', 'data-kind']);
  });
});

/** The props of the span the engine keeps first in a copy of a text of more lines, if any. */
function fabricTextOf(copy: unknown): Record<string, unknown> | undefined {
  const kept = (
    copy as { childList: { tag: string; committed?: { props: Record<string, unknown> } }[] }
  ).childList.find((child) => child.tag.startsWith('svg:kept-'));
  return kept?.committed?.props;
}

@Component({ template: '' })
class Blank {}

describe('the family of a text in a drawing', () => {
  it('is drawn and measured as the first of its stack the platform has, as Chrome on a Mac', async () => {
    // A word cloud writes its words in sans-serif, which Chrome on a Mac draws in Helvetica Bold,
    // and places each word by its width: in the system font they were wider and moved about.
    const { fabric } = await render(Blank, { providers: [provideWebCompat()] });
    const document = (globalThis as unknown as { document: Dom }).document;
    const NS = 'http://www.w3.org/2000/svg';
    const drawing = document.createElementNS(NS, 'svg');
    const word = document.createElementNS(NS, 'text');
    word.style.fontSize = '25px';
    word.style.fontFamily = 'sans-serif';
    word.style.fontWeight = '900';
    word.textContent = 'native';
    drawing.append(word);
    document.body.append(drawing);
    await settle();
    const text = () => fabric.find('RNSVGText')!.props;
    assert.equal((text()['font'] as Record<string, unknown>)['fontFamily'], 'Helvetica');
    assert.ok(Math.abs(word.getComputedTextLength() - 72.25) < 0.25, word.getComputedTextLength());
    assert.ok(Math.abs(word.getBBox().width - 72.25) < 0.25);
    // As tall as Helvetica's line, which is shorter over its baseline than San Francisco's.
    word.setAttribute('y', '100');
    assert.deepEqual([word.getBBox().y, word.getBBox().height], [77, 29]);
    // The stack Highcharts starts with is the system font's, which native draws with no family.
    word.style.fontFamily = '-apple-system, BlinkMacSystemFont, Helvetica, sans-serif';
    word.style.fontWeight = '400';
    await settle();
    assert.equal((text()['font'] as Record<string, unknown>)['fontFamily'], undefined);
    const plain = document.createElementNS(NS, 'text');
    plain.style.fontSize = '25px';
    plain.textContent = 'native';
    drawing.append(plain);
    assert.equal(word.getComputedTextLength(), plain.getComputedTextLength());
    // And a family taken off again is the system font's.
    word.style.fontFamily = 'sans-serif';
    await settle();
    word.style.removeProperty('font-family');
    await settle();
    assert.equal((text()['font'] as Record<string, unknown>)['fontFamily'], undefined);
  });

  it('is measured from the group it is in, as a family is handed down', async () => {
    await render(Blank, { providers: [provideWebCompat()] });
    const document = (globalThis as unknown as { document: Dom }).document;
    const NS = 'http://www.w3.org/2000/svg';
    const drawing = document.createElementNS(NS, 'svg');
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('font-family', 'sans-serif');
    const word = document.createElementNS(NS, 'text');
    word.setAttribute('font-size', '30');
    word.setAttribute('font-weight', '900');
    word.textContent = 'Angular';
    group.append(word);
    drawing.append(group);
    document.body.append(drawing);
    await settle();
    assert.ok(Math.abs(word.getComputedTextLength() - 113.33) < 0.4, word.getComputedTextLength());
  });
});

describe('a drop shadow in a drawing', () => {
  it("is drawn by the native filter's own steps, as Highcharts shadows its tooltip", async () => {
    // Highcharts writes one feDropShadow in a filter and points the tooltip's group at it. The
    // native filter has no drop shadow: it is a blur, moved, flooded with the colour, kept where
    // the blur is, and the shape over it. The tooltip had no shadow at all.
    const { fabric } = await render(Blank, { providers: [provideWebCompat()] });
    const document = (globalThis as unknown as { document: Dom }).document;
    const NS = 'http://www.w3.org/2000/svg';
    const drawing = document.createElementNS(NS, 'svg');
    const defs = document.createElementNS(NS, 'defs');
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'highcharts-drop-shadow-0');
    const shadow = document.createElementNS(NS, 'feDropShadow');
    for (const [name, value] of Object.entries({
      dx: '0',
      dy: '2',
      'flood-color': '#000000',
      'flood-opacity': '0.25',
      stdDeviation: '3',
    })) {
      shadow.setAttribute(name, value);
    }
    filter.append(shadow);
    defs.append(filter);
    const label = document.createElementNS(NS, 'g');
    label.setAttribute('filter', 'url(#highcharts-drop-shadow-0)');
    label.append(document.createElementNS(NS, 'path'));
    drawing.append(defs, label);
    document.body.append(drawing);
    await settle();
    const drawn = fabric.find('RNSVGFilter')!;
    assert.equal(drawn.props['name'], 'highcharts-drop-shadow-0');
    // SVG's region: a tenth of the shape over each side.
    assert.deepEqual(
      [drawn.props['x'], drawn.props['y'], drawn.props['width'], drawn.props['height']],
      ['-10%', '-10%', '120%', '120%'],
    );
    const steps = () =>
      fabric.find('RNSVGFilter')!.children.map(({ viewName, props }) => {
        const { style: _style, ...own } = props as Record<string, unknown>;
        return [viewName, own];
      });
    assert.deepEqual(steps(), [
      ['RNSVGFeGaussianBlur', { in1: 'SourceAlpha', stdDeviationX: 3, stdDeviationY: 3 }],
      ['RNSVGFeOffset', { dx: '0', dy: '2', result: 'offsetblur' }],
      ['RNSVGFeFlood', { floodColor: '#000000', floodOpacity: 0.25 }],
      ['RNSVGFeComposite', { in2: 'offsetblur', operator1: 'in' }],
      ['RNSVGFeMerge', { nodes: ['', 'SourceGraphic'] }],
    ]);
    assert.equal(fabric.find('RNSVGGroup')!.props['filter'], 'highcharts-drop-shadow-0');
    // A script reads the filter as it wrote it: one shadow in it.
    assert.equal(filter.childNodes.length, 1);
    // Changed, the steps are; a blur of two deviations is one for each way.
    shadow.setAttribute('stdDeviation', '4 1');
    shadow.setAttribute('flood-opacity', '0.5');
    await settle();
    assert.deepEqual(steps()[0], [
      'RNSVGFeGaussianBlur',
      { in1: 'SourceAlpha', stdDeviationX: 4, stdDeviationY: 1 },
    ]);
    assert.equal((steps()[2]![1] as Record<string, unknown>)['floodOpacity'], 0.5);
    // Taken out, so are its steps, and the filter draws nothing over the shape.
    shadow.remove();
    await settle();
    assert.deepEqual(steps(), []);
  });

  it('leaves a filter step it cannot draw doing nothing, rather than drawing a view in it', async () => {
    // The native filter stops the app on a child that is no step of its own.
    const { fabric } = await render(Blank, { providers: [provideWebCompat()] });
    const document = (globalThis as unknown as { document: Dom }).document;
    const NS = 'http://www.w3.org/2000/svg';
    const drawing = document.createElementNS(NS, 'svg');
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'rough');
    filter.append(document.createElementNS(NS, 'feTurbulence'));
    drawing.append(filter);
    document.body.append(drawing);
    await settle();
    const steps = fabric.find('RNSVGFilter')!.children;
    assert.deepEqual(
      steps.map((step) => step.viewName),
      ['RNSVGFeOffset'],
    );
    assert.equal(steps[0]!.props['dx'], undefined);
  });
});

describe('the font of a text in a drawing on Android', () => {
  it('is sent as one prop, which a size or weight sent beside it would replace there', async () => {
    // Android's react-native-svg sets the whole font from `fontSize` or `fontWeight` alone, in
    // whichever order the props come: a chart tooltip's bold value was drawn at the text's weight.
    registerPlatformComponents('android');
    try {
      const { fabric } = await render(Blank, { providers: [provideWebCompat()] });
      const document = (globalThis as unknown as { document: Dom }).document;
      const NS = 'http://www.w3.org/2000/svg';
      const drawing = document.createElementNS(NS, 'svg');
      const text = document.createElementNS(NS, 'text');
      const value = document.createElementNS(NS, 'tspan');
      text.setAttribute('style', 'font-size: 12px');
      value.setAttribute('style', 'font-weight: bold');
      value.textContent = '25';
      text.append(value);
      drawing.append(text);
      document.body.append(drawing);
      await settle();
      const span = () => fabric.find('RNSVGTSpan')!.props;
      assert.deepEqual(span()['font'], { fontSize: 12, fontWeight: 'bold' });
      assert.equal(span()['fontSize'], undefined);
      assert.equal(span()['fontWeight'], undefined);
      // Sent again as either changes, and without what is no longer there.
      text.setAttribute('style', 'font-size: 14px');
      await settle();
      assert.deepEqual(span()['font'], { fontSize: 14, fontWeight: 'bold' });
      value.removeAttribute('style');
      await settle();
      assert.deepEqual(span()['font'], { fontSize: 14 });
    } finally {
      registerPlatformComponents('ios');
    }
  });
});
