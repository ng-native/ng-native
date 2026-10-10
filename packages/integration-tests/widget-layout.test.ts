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
const COMPONENTS = [
  'Text',
  'HStack',
  'VStack',
  'Spacer',
  'Divider',
  'ProgressView',
  'Gauge',
  'Chart',
  'Button',
  'Image',
];
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

  it('takes a bannerSmall slot beside the banner, for where the activity is drawn small', () => {
    assert.deepEqual(
      render(`
        <ng-template #banner><ui-spacer /></ng-template>
        <ng-template #bannerSmall><ui-divider /></ng-template>
      `),
      {
        banner: { type: 'Spacer', props: {} },
        bannerSmall: { type: 'Divider', props: {} },
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

  it('draws nothing for an @if with no @else that does not match, inside a ui-text', () => {
    assert.deepEqual(render('<ui-text>Hello @if (props().x) { there }</ui-text>', { x: false }), {
      type: 'Text',
      props: { children: 'Hello' },
    });
    assert.deepEqual(render('<ui-text>@if (props().x) { hi }</ui-text>', { x: false }).props, {
      children: '',
    });
  });

  it('keeps a non-breaking space, which Angular does not collapse', () => {
    assert.deepEqual(render('<ui-text>Sets&nbsp;&nbsp;Games</ui-text>'), {
      type: 'Text',
      props: { children: 'Sets\u00a0\u00a0Games' },
    });
  });

  it('keeps a no-break space at either end, and one alone, where the space beside it goes', () => {
    assert.equal(render('<ui-text> &nbsp;a&nbsp; </ui-text>').props['children'], '\u00a0a\u00a0');
    assert.equal(render('<ui-text>&nbsp;</ui-text>').props['children'], '\u00a0');
    assert.equal(
      render('<ui-text>{{ props().x }}</ui-text>', { x: ' \t\u00a0a\u00a0\n' }).props['children'],
      '\u00a0a\u00a0',
    );
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

  it('hands a date to a ui-text as the Date the extension draws from, whatever the props hold it as', () => {
    const at = Date.UTC(2026, 9, 10, 12);
    for (const held of [at, new Date(at).toISOString(), new Date(at)]) {
      assert.deepEqual(
        render('<ui-text [date]="props().at" dateStyle="relative" />', { at: held }),
        {
          type: 'Text',
          props: { date: new Date(at), dateStyle: 'relative' },
        },
      );
    }
  });

  it('hands a timer its two ends as Dates, on a ui-text and on a ui-progress', () => {
    const props = { from: 1000, to: '1970-01-01T00:01:00.000Z' };
    const timerInterval = { lower: new Date(1000), upper: new Date(60000) };
    assert.deepEqual(
      render(
        '<ui-text [timerInterval]="{ lower: props().from, upper: props().to }" countsDown="false" />',
        props,
      ),
      { type: 'Text', props: { timerInterval, countsDown: false } },
    );
    assert.deepEqual(
      render(
        '<ui-progress [timerInterval]="{ lower: props().from, upper: props().to }" countsDown />',
        props,
      ),
      { type: 'ProgressView', props: { timerInterval, countsDown: true } },
    );
  });

  it('leaves out a date or a timer the props do not hold yet, so the text is drawn instead', () => {
    assert.deepEqual(
      render(
        '<ui-text [date]="props().at" [timerInterval]="{ lower: props().from, upper: props().to }">Soon</ui-text>',
        { from: 1000 },
      ),
      { type: 'Text', props: { date: undefined, timerInterval: undefined, children: 'Soon' } },
    );
    assert.deepEqual(
      render(
        '<ui-text [date]="props().at" [timerInterval]="{ lower: props().from, upper: props().to }">Soon</ui-text>',
        { at: 'soon', from: 1000, to: 'later' },
      ),
      { type: 'Text', props: { date: undefined, timerInterval: undefined, children: 'Soon' } },
      'a string that is no moment',
    );
  });

  it('names an image by its symbol, by an asset in the extension, or by a file', () => {
    assert.deepEqual(
      render(
        `<ui-hstack>
          <ui-image systemName="tennisball.fill" />
          <ui-image assetName="court" [size]="20" />
          <ui-image [uiImage]="props().crest" />
        </ui-hstack>`,
        { crest: 'file:///group/crest.png' },
      ).props['children'],
      [
        { type: 'Image', props: { systemName: 'tennisball.fill' } },
        { type: 'Image', props: { assetName: 'court', size: 20 } },
        { type: 'Image', props: { uiImage: 'file:///group/crest.png' } },
      ],
    );
  });

  it("draws a ui-chart as the extension's Chart, its data and styles as they are bound", () => {
    assert.deepEqual(
      render(
        '<ui-chart type="bar" showGrid [data]="props().sets" [barStyle]="{ cornerRadius: 4 }" />',
        { sets: [{ x: 'Set 1', y: 6 }] },
      ),
      {
        type: 'Chart',
        props: {
          type: 'bar',
          showGrid: true,
          data: [{ x: 'Set 1', y: 6 }],
          barStyle: { cornerRadius: 4 },
        },
      },
    );
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

describe('members', () => {
  it("keeps a constant from hiding the extension's globals or another member's modifier", () => {
    assert.deepEqual(
      render(
        '<ui-text [modifiers]="[pad({ all: padding })]">{{ Text }}</ui-text>',
        {},
        {},
        {
          ...MEMBERS,
          modifiers: { pad: 'padding' },
          constants: { padding: '16', Text: "'x'" },
        },
      ),
      {
        type: 'Text',
        props: { children: 'x', modifiers: [{ $type: 'padding', args: [{ all: 16 }] }] },
      },
    );
  });

  it('reads no member Object.prototype has, such as toString', () => {
    fails('<ui-text>{{ toString }}</ui-text>', /toString is not a member/);
    fails('<ui-text>{{ constructor }}</ui-text>', /constructor is not a member/);
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

  it('reads the environment a Live Activity is drawn in, in a slot', () => {
    const banner = `<ng-template #banner>
      @if (environment().isStale) { <ui-text>Out of date</ui-text> } @else { <ui-text>{{ props().us }}</ui-text> }
    </ng-template>`;
    assert.deepEqual(render(banner, { us: '15' }, { isStale: true }), {
      banner: { type: 'Text', props: { children: 'Out of date' } },
    });
    assert.deepEqual(render(banner, { us: '15' }, { isStale: false }), {
      banner: { type: 'Text', props: { children: '15' } },
    });
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

  it('takes in, with spaces kept around it', () => {
    assert.equal(text("'a' in props()", { a: 1 }), true);
  });

  it('answers null from a safe read that stops, as Angular does, through the whole chain', () => {
    assert.equal(text('props().a?.b === null', { a: null }), true);
    assert.equal(text("props().a?.b.c ?? 'none'", { a: null }), 'none');
    assert.equal(text('props().a?.b.c', { a: { b: { c: 'deep' } } }), 'deep');
    assert.equal(text('props().a?.b === undefined', { a: {} }), true, 'a missing key is undefined');
    assert.equal(text("props().f?.() ?? 'none'", { f: null }), 'none');
    assert.equal(text("props().list?.[0] ?? 'none'", { list: null }), 'none');
  });

  it('takes template literals', () => {
    assert.equal(text('`Us ${props().us}`', { us: 'AD' }), 'Us AD');
  });
});

type Press = () => Record<string, unknown>;

describe('buttons', () => {
  it("record their target in the props' taps, for the app to collect", () => {
    const view = render('<ui-button target="us" label="Us" />', { us: '0', taps: ['them'] });
    assert.equal(view.type, 'Button');
    assert.equal(view.props['target'], 'us');
    assert.equal(view.props['label'], 'Us');
    assert.deepEqual((view.props['onPress'] as Press)(), { us: '0', taps: ['them', 'us'] });
  });

  it('start the taps when the props have none', () => {
    const view = render('<ui-button target="us"><ui-text>Us</ui-text></ui-button>', { us: '0' });
    assert.deepEqual((view.props['onPress'] as Press)(), { us: '0', taps: ['us'] });
    assert.deepEqual(view.props['children'], { type: 'Text', props: { children: 'Us' } });
  });

  it('take a bound target', () => {
    const view = render('<ui-button [target]="props().side" />', { side: 'them' });
    assert.deepEqual((view.props['onPress'] as Press)(), { side: 'them', taps: ['them'] });
  });

  it('change what the widget shows at once by (buttonPress), with the props it answers', () => {
    const view = render(
      '<ui-button target="us" (buttonPress)="{ us: next[props().us] }" />',
      { us: '15', them: '0' },
      {},
      { ...MEMBERS, constants: { next: '{"0":"15","15":"30"}' } },
    );
    assert.deepEqual((view.props['onPress'] as Press)(), { us: '30', them: '0', taps: ['us'] });
  });

  it('send only their target from a Live Activity, where the tap goes to the app', () => {
    assert.deepEqual(
      render(
        `
        <ng-template #banner>
          <ui-hstack>
            <ui-button target="us" label="Us" />
            <ui-button [target]="props().side"><ui-spacer /></ui-button>
          </ui-hstack>
        </ng-template>
      `,
        { side: 'them' },
      ),
      {
        banner: {
          type: 'HStack',
          props: {
            children: [
              { type: 'Button', props: { target: 'us', label: 'Us' } },
              {
                type: 'Button',
                props: { target: 'them', children: { type: 'Spacer', props: {} } },
              },
            ],
          },
        },
      },
    );
  });

  it('keep the taps their (buttonPress) did not mean to replace', () => {
    const view = render('<ui-button target="us" (buttonPress)="{ taps: [] }" />', {
      taps: ['them'],
    });
    assert.deepEqual((view.props['onPress'] as Press)(), { taps: ['them', 'us'] });
  });
});

describe('a layout the compiler refuses', () => {
  it('names a view the extension cannot draw, with where it is', () => {
    fails(
      '<ui-vstack>\n  <ui-toggle />\n</ui-vstack>',
      /^LayoutError: layout\.ts:2:3: <ui-toggle> is not a view the widget extension can draw/,
    );
  });

  it('refuses a (buttonPress) in a Live Activity, whose props only the app changes', () => {
    fails(
      `<ng-template #banner>
        <ui-button target="a" (buttonPress)="{ us: 1 }" label="Point" />
      </ng-template>`,
      /layout\.ts:2:31: \(buttonPress\) changes a home-screen widget's props.*Live Activity/,
    );
  });

  it('refuses a Live Activity button with no target, which the app could not tell from the others', () => {
    fails(
      '<ng-template #banner><ui-button label="Point" /></ng-template>',
      /layout\.ts:1:22: <ui-button> needs a target/,
    );
  });

  it('refuses a button with no target, which the app could not tell from the others', () => {
    fails(
      '<ui-button label="Point" />',
      /^LayoutError: layout\.ts:1:1: <ui-button> needs a target/,
    );
  });

  it('refuses a button event that is not one expression answering the props to change', () => {
    fails('<ui-button target="a" (buttonPress)="a(); b()" />', /\(buttonPress\).*one expression/);
    fails('<ui-button target="a" (other)="x" />', /\(other\)/);
  });

  it('refuses an assignment, which would change the props in place', () => {
    fails(
      `<ui-button target="a" (buttonPress)="props().us = '15'" />`,
      /^LayoutError: layout\.ts:1:\d+: An assignment is not something a layout expression can do/,
    );
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

  it('refuses a member it cannot inline, naming where it is read', () => {
    fails('<ui-text [text]="other" />', /^LayoutError: layout\.ts:1:18: other is not a member/);
    fails(
      '<ui-vstack>\n  <ui-text>{{ props().a + nope }}</ui-text>\n</ui-vstack>',
      /layout\.ts:2:27: nope/,
    );
  });

  it('names where a pipe is', () => {
    fails(
      '<ui-text [text]="props().n | number" />',
      /^LayoutError: layout\.ts:1:18: The number pipe/,
    );
  });

  it('refuses a widget root that can draw nothing or a list of views', () => {
    fails('@if (props().on) { <ui-spacer /> }', /@if.*@else/);
    fails('@switch (props().n) { @case (1) { <ui-spacer /> } }', /@switch.*@default/);
    fails('@for (n of props().list; track n) { <ui-spacer /> }', /@for.*list/);
    fails('@if (props().on) { <ui-spacer /><ui-divider /> } @else { <ui-spacer /> }', /one view/);
  });

  it('refuses a slot that draws a list of views', () => {
    fails('<ng-template #banner><ui-spacer /><ui-divider /></ng-template>', /one view/);
    fails(
      '<ng-template #banner>@for (n of props().list; track n) { <ui-spacer /> }</ng-template>',
      /@for.*list/,
    );
  });

  it('refuses a view the widget extension cannot draw', () => {
    fails('<ui-toggle />', /<ui-toggle> is not a view the widget extension can draw/);
  });

  it('refuses a slot a Live Activity does not have', () => {
    fails('<ng-template #header><ui-spacer /></ng-template>', /header.*not a Live Activity slot/s);
  });

  it('refuses a slot named twice, naming the second', () => {
    fails(
      '<ng-template #banner><ui-spacer /></ng-template>\n<ng-template #banner><ui-divider /></ng-template>',
      /^LayoutError: layout\.ts:2:1: #banner is filled twice/,
    );
  });

  it('refuses a number written as text that is not one', () => {
    fails(
      '<ui-vstack>\n  <ui-vstack spacing="wide" />\n</ui-vstack>',
      /^LayoutError: layout\.ts:2:14: spacing="wide" is not a number/,
    );
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
