/**
 * The widget layout compiler: an Angular template, compiled to the function `expo-widgets`
 * evaluates in the widget extension, where it is called with the props (and, for a home-screen
 * widget, the environment) and answers a tree of native SwiftUI views.
 *
 * Each test compiles a template and evaluates the result with a stand-in for the extension's
 * modifier functions, then reads the tree. `widget-extension.test.ts` runs the same output through
 * the extension's own bundle.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { compileWidgetLayout } = require('@ng-native/metro/widget-layout.cjs') as {
  compileWidgetLayout: (
    template: string,
    options: {
      file?: string;
      members?: {
        props?: string;
        environment?: string;
        modifiers?: Record<string, string>;
        constants?: Record<string, string>;
      };
    },
  ) => string;
};

/** What the extension's modifier functions answer: a description native applies. */
const modifier =
  ($type: string) =>
  (...args: unknown[]) => ({ $type, args });

/**
 * Stand-ins for the extension's globals: each component is its name, and the JSX runtime answers
 * the call it was given. `widget-extension.test.ts` runs the real ones.
 */
const COMPONENTS = ['Text', 'HStack', 'VStack', 'Spacer', 'Divider', 'ProgressView', 'Gauge'];
const GLOBALS = {
  _jsx: (type: string, props: Record<string, unknown>) => ({ type, props }),
  ...Object.fromEntries(COMPONENTS.map((name) => [name, name])),
  font: modifier('font'),
  padding: modifier('padding'),
  tint: modifier('tint'),
};

const MEMBERS = {
  props: 'props',
  environment: 'environment',
  modifiers: { font: 'font', padding: 'padding', tint: 'tint' },
};

/** A view as the stand-in JSX runtime answers it. */
interface View {
  readonly type: string;
  readonly props: Record<string, unknown>;
}

/** Compiles `template` and calls the layout with `props`, as the extension does. */
function render(
  template: string,
  props: Record<string, unknown> = {},
  environment: Record<string, unknown> = {},
  members: Parameters<typeof compileWidgetLayout>[1]['members'] = MEMBERS,
): View {
  const source = compileWidgetLayout(template, { file: 'layout.ts', members });
  const layout = new Function(...Object.keys(GLOBALS), `return (${source});`)(
    ...Object.values(GLOBALS),
  ) as (props: unknown, environment: unknown) => View;
  return layout(props, environment);
}

const fails = (template: string, pattern: RegExp, members = MEMBERS) =>
  assert.throws(() => compileWidgetLayout(template, { file: 'layout.ts', members }), pattern);

describe('a widget layout', () => {
  it('is one root view, for a home-screen widget', () => {
    assert.deepEqual(render('<ui-spacer />'), { type: 'Spacer', props: {} });
  });

  it('is one view per slot, for a Live Activity', () => {
    assert.deepEqual(
      render(`
        <ng-template #banner><ui-spacer /></ng-template>
        <ng-template #minimal><ui-divider /></ng-template>
      `),
      {
        banner: { type: 'Spacer', props: {} },
        minimal: { type: 'Divider', props: {} },
      },
    );
  });

  it('nests views as children, one or several', () => {
    assert.deepEqual(render('<ui-vstack><ui-spacer /></ui-vstack>'), {
      type: 'VStack',
      props: { children: { type: 'Spacer', props: {} } },
    });
    assert.deepEqual(render('<ui-hstack><ui-spacer /><ui-divider /></ui-hstack>'), {
      type: 'HStack',
      props: {
        children: [
          { type: 'Spacer', props: {} },
          { type: 'Divider', props: {} },
        ],
      },
    });
  });
});

describe('text', () => {
  it("is a ui-text's content, with the props read where they are interpolated", () => {
    assert.deepEqual(
      render('<ui-text>Us {{ props().us }} - {{ props().them }} Them</ui-text>', {
        us: '30',
        them: '15',
      }),
      {
        type: 'Text',
        props: { children: 'Us 30 - 15 Them' },
      },
    );
  });

  it('drops the whitespace at the two ends, and collapses each run inside, as Angular does in an app', () => {
    assert.deepEqual(
      render(
        `<ui-text>
        Sets {{ props().sets }}  Games {{ props().games }}
      </ui-text>`,
        { sets: '0-0', games: '2-1' },
      ),
      { type: 'Text', props: { children: 'Sets 0-0 Games 2-1' } },
    );
  });

  it('keeps a non-breaking space, which Angular does not collapse', () => {
    assert.deepEqual(render('<ui-text>Sets&nbsp;&nbsp;Games</ui-text>'), {
      type: 'Text',
      props: { children: 'Sets\u00a0\u00a0Games' },
    });
  });

  it('is text, which wins over the content', () => {
    assert.deepEqual(render('<ui-text text="bound">content</ui-text>'), {
      type: 'Text',
      props: { children: 'bound' },
    });
    assert.deepEqual(render('<ui-text [text]="props().title" />', { title: 'Live' }), {
      type: 'Text',
      props: { children: 'Live' },
    });
  });

  it('can be chosen by @if inside a ui-text', () => {
    const template = `<ui-text>
      @if (props().winner) { {{ props().winner }} win } @else { Sets {{ props().sets }} }
    </ui-text>`;
    assert.deepEqual(render(template, { winner: 'Us', sets: '1-0' }), {
      type: 'Text',
      props: { children: 'Us win' },
    });
    assert.deepEqual(render(template, { winner: '', sets: '1-0' }), {
      type: 'Text',
      props: { children: 'Sets 1-0' },
    });
  });
});

describe('inputs', () => {
  it('reads a number written as a static attribute as the number the typed component takes', () => {
    assert.deepEqual(render('<ui-vstack spacing="8" alignment="leading" />'), {
      type: 'VStack',
      props: { spacing: 8, alignment: 'leading' },
    });
  });

  it("draws a gauge's label string as the Text the extension's Gauge takes there", () => {
    assert.deepEqual(render('<ui-gauge value="1" currentValueLabel="done" />'), {
      type: 'Gauge',
      props: { value: 1, currentValueLabel: { type: 'Text', props: { children: 'done' } } },
    });
  });

  it('passes a bound input through as its value', () => {
    assert.deepEqual(render('<ui-progress [value]="props().done / 4" />', { done: 1 }), {
      type: 'ProgressView',
      props: { value: 0.25 },
    });
  });

  it("calls a modifier a class member stands for as the extension's own function", () => {
    assert.deepEqual(
      render(`<ui-text [modifiers]="[font({ size: 34 }), padding({ all: 16 })]">x</ui-text>`),
      {
        type: 'Text',
        props: {
          children: 'x',
          modifiers: [
            { $type: 'font', args: [{ size: 34 }] },
            { $type: 'padding', args: [{ all: 16 }] },
          ],
        },
      },
    );
  });

  it("inlines a constant member's value", () => {
    assert.deepEqual(
      render(
        '<ui-text [modifiers]="[tint(ball)]">x</ui-text>',
        {},
        {},
        {
          ...MEMBERS,
          constants: { ball: "'#d7f23c'" },
        },
      ),
      { type: 'Text', props: { children: 'x', modifiers: [{ $type: 'tint', args: ['#d7f23c'] }] } },
    );
  });
});

describe('control flow', () => {
  it('shares an @let before the slots across them', () => {
    assert.deepEqual(
      render(`
        @let big = font({ size: 34 });
        <ng-template #banner><ui-text [modifiers]="[big]">a</ui-text></ng-template>
        <ng-template #minimal><ui-text [modifiers]="[big]">b</ui-text></ng-template>
      `),
      {
        banner: {
          type: 'Text',
          props: { children: 'a', modifiers: [{ $type: 'font', args: [{ size: 34 }] }] },
        },
        minimal: {
          type: 'Text',
          props: { children: 'b', modifiers: [{ $type: 'font', args: [{ size: 34 }] }] },
        },
      },
    );
  });

  it('keeps an @let inside a view to that view', () => {
    assert.deepEqual(
      render('<ui-vstack>@let label = props().n + 1; <ui-text>{{ label }}</ui-text></ui-vstack>', {
        n: 1,
      }),
      { type: 'VStack', props: { children: { type: 'Text', props: { children: '2' } } } },
    );
  });

  it('draws a view by @if, @else if and @else, and nothing when no branch matches', () => {
    const template = `<ui-hstack>
      @if (props().n > 1) { <ui-spacer /> } @else if (props().n === 1) { <ui-divider /> }
    </ui-hstack>`;
    assert.deepEqual(render(template, { n: 2 }).props['children'], { type: 'Spacer', props: {} });
    assert.deepEqual(render(template, { n: 1 }).props['children'], { type: 'Divider', props: {} });
    assert.equal(render(template, { n: 0 }).props['children'], undefined);
  });

  it('repeats a view by @for, with $index and the other contextual names', () => {
    assert.deepEqual(
      render(
        `<ui-vstack>@for (set of props().sets; track $index; let i = $index, last = $last) {
          <ui-text>{{ i }}:{{ set }}{{ last ? '.' : ',' }}</ui-text>
        }</ui-vstack>`,
        { sets: ['6-4', '3-6'] },
      ).props['children'],
      [
        { type: 'Text', props: { children: '0:6-4,' } },
        { type: 'Text', props: { children: '1:3-6.' } },
      ],
    );
  });

  it('draws @empty when @for has nothing to repeat', () => {
    assert.deepEqual(
      render(
        '<ui-vstack>@for (s of props().sets; track s) { <ui-spacer /> } @empty { <ui-divider /> }</ui-vstack>',
        {
          sets: [],
        },
      ).props['children'],
      { type: 'Divider', props: {} },
    );
  });

  it('chooses a view by @switch, falling back to @default', () => {
    const template = `@switch (props().family) {
      @case ('systemSmall') { <ui-spacer /> }
      @default { <ui-divider /> }
    }`;
    assert.deepEqual(render(template, { family: 'systemSmall' }), { type: 'Spacer', props: {} });
    assert.deepEqual(render(template, { family: 'systemLarge' }), { type: 'Divider', props: {} });
  });

  it('reads the environment a home-screen widget is drawn in', () => {
    assert.deepEqual(
      render('<ui-text>{{ environment().family }}</ui-text>', {}, { family: 'systemSmall' }),
      {
        type: 'Text',
        props: { children: 'systemSmall' },
      },
    );
  });
});

describe('expressions', () => {
  const text = (expression: string, props: Record<string, unknown>) =>
    render(`<ui-text [text]="${expression}" />`, props).props['children'];

  it('reads safely, with ?. and ??, as Angular does', () => {
    assert.equal(text("props().player?.name ?? 'nobody'", { player: null }), 'nobody');
    assert.equal(text('props().player?.name', { player: { name: 'Ana' } }), 'Ana');
  });

  it('reads keys, calls methods on values, and builds arrays and objects', () => {
    assert.equal(
      text("props().scores[1] + '-' + props().names.join('/')", {
        scores: [6, 4],
        names: ['a', 'b'],
      }),
      '4-a/b',
    );
  });

  it('takes conditions, arithmetic, comparison, negation and typeof', () => {
    assert.equal(text("!props().on ? (props().n * 2) % 5 : 'on'", { on: false, n: 4 }), 3);
    assert.equal(text("typeof props().n === 'number' ? 'yes' : 'no'", { n: 1 }), 'yes');
  });

  it('takes template literals', () => {
    assert.equal(text('`Us ${props().us}`', { us: 'AD' }), 'Us AD');
  });
});

describe('a layout the compiler refuses', () => {
  it('names a view the extension cannot draw, with where it is', () => {
    fails(
      '<ui-vstack>\n  <ui-toggle />\n</ui-vstack>',
      /^LayoutError: layout\.ts:2:3: <ui-toggle> is not a view the widget extension can draw/,
    );
  });

  it('refuses a button, which a layout has no event to run', () => {
    fails('<ui-button label="Point" />', /<ui-button> is not a view the widget extension can draw/);
  });

  it('names an element that is not a ui- view', () => {
    fails('<view />', /<view>.*not a ui- view/s);
  });

  it('refuses an event binding, which a layout cannot run', () => {
    fails('<ui-spacer (click)="x()" />', /\(click\)/);
  });

  it('refuses a pipe', () => {
    fails('<ui-text [text]="props().n | number" />', /pipe/);
  });

  it('refuses a member it cannot inline', () => {
    fails('<ui-text [text]="other" />', /other.*member/s);
  });

  it('refuses a slot a Live Activity does not have', () => {
    fails('<ng-template #header><ui-spacer /></ng-template>', /header.*not a Live Activity slot/s);
  });

  it('refuses more than one root for a widget', () => {
    fails('<ui-spacer /><ui-divider />', /one root/);
  });

  it('refuses a view nested in a ui-text, which the extension drops', () => {
    fails(
      '<ui-text>Us <ui-text>30</ui-text></ui-text>',
      /layout\.ts:1:13: .*drops a view nested in a text/,
    );
  });

  it('refuses content projection, references and class or style bindings', () => {
    fails('<ui-vstack><ng-content /></ui-vstack>', /ng-content/);
    fails('<ui-spacer #gap />', /#gap/);
    fails('<ui-spacer [class.big]="true" />', /class/);
  });

  it('reports a template that does not parse', () => {
    fails('@if (props().on) { <ui-spacer />', /^LayoutError: layout\.ts:1:1: Unclosed block/);
  });
});
