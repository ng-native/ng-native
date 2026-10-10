/**
 * Parity with the widget extension itself: each layout is written twice, as an Angular template
 * and as the JSX `expo-widgets` documents, and both run through the extension's own bundle - built
 * here as Xcode builds it - to the tree native draws. The two trees must be the same.
 *
 * The JSX twin is compiled as an app's build compiles it: React's JSX transform, then the
 * `'widget'` directive turning the function into its own source.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { compileWidgetLayout } = require('@ng-native/metro/widget-layout.cjs') as {
  compileWidgetLayout: (
    template: string,
    options: { file?: string; members?: Record<string, unknown> },
  ) => string;
};

const { transformSync } = require('@babel/core') as {
  transformSync: (code: string, options: object) => { code: string } | null;
};

const widgets = dirname(require.resolve('expo-widgets/package.json'));
const presetExpo = dirname(
  require.resolve('babel-preset-expo/package.json', { paths: [require.resolve('expo')] }),
);
const { widgetsPlugin } = require(join(presetExpo, 'build/plugins/widgets-plugin.js')) as {
  widgetsPlugin: object;
};

/** The extension's bundle, built by `expo-widgets`' own build step against this checkout. */
let bundle = '';
before(() => {
  const output = join(mkdtempSync(join(tmpdir(), 'expo-widgets-')), 'ExpoWidgets.bundle');
  execFileSync(
    process.execPath,
    [
      require.resolve('expo/bin/cli'),
      'export:embed',
      '--platform',
      'ios',
      '--entry-file',
      join(widgets, 'bundle/index.ts'),
      '--bundle-output',
      output,
      '--dev',
      'false',
      '--skip-server',
    ],
    {
      cwd: import.meta.dirname,
      env: {
        ...process.env,
        CI: '1',
        EXPO_OVERRIDE_METRO_CONFIG: join(widgets, 'metro.config.js'),
      },
      stdio: 'pipe',
    },
  );
  bundle = readFileSync(output, 'utf8');
});

/** Renders a layout's source as the extension does, to the JSON native decodes. */
function extensionRender(source: string, props: unknown, environment: unknown = {}): unknown {
  const context = vm.createContext({ console, nativePerformanceNow: () => 0 });
  context['globalThis'] = context;
  vm.runInContext(bundle, context);
  vm.runInContext(`globalThis.__expoWidgetLayout = (${source});`, context);
  context['__props'] = props;
  context['__environment'] = environment;
  return JSON.parse(
    JSON.stringify(vm.runInContext('__expoWidgetRender(__props, __environment)', context)),
  );
}

/**
 * Presses the button `target` names, as the extension's `WidgetUserInteraction` intent does: it
 * draws the layout again and runs that button's `onPress`, and the props it answers are merged into
 * the widget's.
 */
function extensionPress(source: string, props: unknown, target: string): unknown {
  const context = vm.createContext({ console, nativePerformanceNow: () => 0 });
  context['globalThis'] = context;
  vm.runInContext(bundle, context);
  vm.runInContext(`globalThis.__expoWidgetLayout = (${source});`, context);
  context['__props'] = props;
  context['__target'] = target;
  return JSON.parse(
    JSON.stringify(
      vm.runInContext('__expoWidgetHandlePress(__props, { target: __target })', context),
    ),
  );
}

/**
 * A tree as native reads it. `DynamicView.swift`'s `flattenChildNodes` flattens nested child
 * arrays, drops what is not a view (`false`, `null`, a string) and reads one child as a list of one,
 * so two trees that differ only there draw the same.
 */
function asNative(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(asNative);
  if (typeof node !== 'object' || node === null) return node;
  const { children, ...props } = (node as { props?: Record<string, unknown> }).props ?? {};
  const views = children === undefined ? [] : [children].flat(Infinity).filter(isView);
  return {
    ...node,
    props: {
      ...Object.fromEntries(Object.entries(props).map(([key, value]) => [key, asNative(value)])),
      ...(views.length ? { children: views.map(asNative) } : {}),
    },
  };
}

const isView = (child: unknown): boolean =>
  typeof child === 'object' && child !== null && !Array.isArray(child);

/** The source the `'widget'` directive makes of a JSX layout function. */
function jsxSource(layout: string): string {
  const { code } = transformSync(`export default ${layout}`, {
    babelrc: false,
    configFile: false,
    filename: 'layout.tsx',
    plugins: [
      [require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }],
      widgetsPlugin,
    ],
  })!;
  const literal = /export default `([\s\S]*)`;\s*$/.exec(code);
  assert.ok(literal, `the widget directive made a string of the layout:\n${code}`);
  return literal[1]!.replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
}

/** The extension's modifier functions a layout's class names, as members of the same name. */
const MODIFIERS = ['font', 'foregroundStyle', 'padding', 'frame', 'background', 'opacity'];
const MEMBERS = {
  props: 'props',
  environment: 'environment',
  modifiers: Object.fromEntries(MODIFIERS.map((name) => [name, name])),
};

/** Asserts the template and its JSX twin render the same tree for each set of props. */
function same(
  template: string,
  jsx: string,
  cases: readonly { props?: unknown; environment?: unknown }[] = [{}],
): void {
  const angular = compileWidgetLayout(template, { file: 'layout.ts', members: MEMBERS });
  const twin = jsxSource(jsx);
  for (const { props = {}, environment = {} } of cases) {
    const expected = asNative(extensionRender(twin, props, environment));
    assert.deepEqual(asNative(extensionRender(angular, props, environment)), expected);
  }
}

describe('a layout through the widget extension', () => {
  it('draws the padel score Live Activity as its JSX does, in every slot', () => {
    same(
      `
      @let ball = '#d7f23c';
      @let muted = '#8fa3c9';
      @let big = font({ size: 34, weight: 'heavy', design: 'rounded' });
      @let compact = font({ weight: 'bold', design: 'rounded' });
      <ng-template #banner>
        <ui-hstack [modifiers]="[padding({ all: 16 })]">
          <ui-vstack>
            <ui-text [modifiers]="[font({ size: 13, weight: 'semibold' }), foregroundStyle(muted)]">
              @if (props().winner) { {{ props().winner }} win } @else { Sets {{ props().sets }} Games {{ props().games }} }
            </ui-text>
            <ui-text [modifiers]="[big]">Us {{ props().us }} - {{ props().them }} Them</ui-text>
          </ui-vstack>
          <ui-spacer />
        </ui-hstack>
      </ng-template>
      <ng-template #compactLeading><ui-text [modifiers]="[compact, foregroundStyle(ball)]">{{ props().us }}</ui-text></ng-template>
      <ng-template #compactTrailing><ui-text [modifiers]="[compact]">{{ props().them }}</ui-text></ng-template>
      <ng-template #minimal><ui-text [modifiers]="[compact, foregroundStyle(ball)]">{{ props().us }}</ui-text></ng-template>
      <ng-template #expandedLeading>
        <ui-text [modifiers]="[font({ size: 28, weight: 'heavy', design: 'rounded' }), foregroundStyle(ball)]">Us {{ props().us }}</ui-text>
      </ng-template>
      <ng-template #expandedTrailing>
        <ui-text [modifiers]="[font({ size: 28, weight: 'heavy', design: 'rounded' })]">{{ props().them }} Them</ui-text>
      </ng-template>
      <ng-template #expandedBottom>
        <ui-text [modifiers]="[font({ size: 14 }), foregroundStyle(muted)]">Sets {{ props().sets }} Games {{ props().games }}</ui-text>
      </ng-template>
      `,
      `(score) => {
        'widget';
        const ball = '#d7f23c';
        const muted = '#8fa3c9';
        const big = font({ size: 34, weight: 'heavy', design: 'rounded' });
        const compact = font({ weight: 'bold', design: 'rounded' });
        return {
          banner: (
            <HStack modifiers={[padding({ all: 16 })]}>
              <VStack>
                <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(muted)]}>
                  {score.winner ? \`\${score.winner} win\` : \`Sets \${score.sets} Games \${score.games}\`}
                </Text>
                <Text modifiers={[big]}>{\`Us \${score.us} - \${score.them} Them\`}</Text>
              </VStack>
              <Spacer />
            </HStack>
          ),
          compactLeading: <Text modifiers={[compact, foregroundStyle(ball)]}>{score.us}</Text>,
          compactTrailing: <Text modifiers={[compact]}>{score.them}</Text>,
          minimal: <Text modifiers={[compact, foregroundStyle(ball)]}>{score.us}</Text>,
          expandedLeading: (
            <Text modifiers={[font({ size: 28, weight: 'heavy', design: 'rounded' }), foregroundStyle(ball)]}>
              {\`Us \${score.us}\`}
            </Text>
          ),
          expandedTrailing: (
            <Text modifiers={[font({ size: 28, weight: 'heavy', design: 'rounded' })]}>{\`\${score.them} Them\`}</Text>
          ),
          expandedBottom: (
            <Text modifiers={[font({ size: 14 }), foregroundStyle(muted)]}>{\`Sets \${score.sets} Games \${score.games}\`}</Text>
          ),
        };
      }`,
      [
        { props: { us: '30', them: '15', sets: '1-0', games: '3-2', winner: '' } },
        { props: { us: '0', them: '0', sets: '2-0', games: '0-0', winner: 'Us' } },
      ],
    );
  });

  it('draws a home-screen widget by its family, as its JSX does', () => {
    same(
      `@switch (environment().widgetFamily) {
        @case ('systemSmall') { <ui-text>{{ props().count }}</ui-text> }
        @default {
          <ui-vstack alignment="leading" spacing="4">
            <ui-text [modifiers]="[font({ size: 12 })]">Habits</ui-text>
            <ui-text>{{ props().count }} done</ui-text>
          </ui-vstack>
        }
      }`,
      `(props, environment) => {
        'widget';
        switch (environment.widgetFamily) {
          case 'systemSmall': return <Text>{String(props.count)}</Text>;
          default: return (
            <VStack alignment="leading" spacing={4}>
              <Text modifiers={[font({ size: 12 })]}>Habits</Text>
              <Text>{\`\${props.count} done\`}</Text>
            </VStack>
          );
        }
      }`,
      [
        { props: { count: 3 }, environment: { widgetFamily: 'systemSmall' } },
        { props: { count: 3 }, environment: { widgetFamily: 'systemMedium' } },
      ],
    );
  });

  it("draws a widget's buttons as their JSX does, and a press records its target", () => {
    const template = `<ui-hstack>
      <ui-button target="us" (buttonPress)="{ us: props().us + 1 }">
        <ui-text>Us {{ props().us }}</ui-text>
      </ui-button>
      <ui-button target="them" label="Them" />
    </ui-hstack>`;
    same(
      template,
      `(props) => {
        'widget';
        const taps = (side) => [...(Array.isArray(props.taps) ? props.taps : []), side];
        return (
          <HStack>
            <Button target="us" onPress={() => ({ ...props, us: props.us + 1, taps: taps('us') })}>
              <Text>{\`Us \${props.us}\`}</Text>
            </Button>
            <Button target="them" label="Them" onPress={() => ({ ...props, taps: taps('them') })} />
          </HStack>
        );
      }`,
      [{ props: { us: 2 } }],
    );
    const angular = compileWidgetLayout(template, { file: 'layout.ts', members: MEMBERS });
    assert.deepEqual(extensionPress(angular, { us: 2, taps: ['them'] }, 'us'), {
      us: 3,
      taps: ['them', 'us'],
    });
    assert.deepEqual(extensionPress(angular, { us: 2 }, 'them'), { us: 2, taps: ['them'] });
  });

  it('repeats a view by @for as a map does, and draws @empty in its place', () => {
    same(
      `<ui-vstack>
        @for (set of props().sets; track $index) { <ui-text>{{ set }}</ui-text> }
        @empty { <ui-text>No sets</ui-text> }
      </ui-vstack>`,
      `(props) => {
        'widget';
        return (
          <VStack>
            {props.sets.length ? props.sets.map((set) => <Text>{set}</Text>) : <Text>No sets</Text>}
          </VStack>
        );
      }`,
      [
        { props: { sets: ['6-4', '3-6', '7-5'] } },
        { props: { sets: ['6-4'] } },
        { props: { sets: [] } },
      ],
    );
  });

  it('draws nothing where @if matches no branch, as false does in JSX', () => {
    same(
      '<ui-hstack><ui-text>a</ui-text>@if (props().on) { <ui-spacer /> }<ui-text>b</ui-text></ui-hstack>',
      `(props) => {
        'widget';
        return <HStack><Text>a</Text>{props.on && <Spacer />}<Text>b</Text></HStack>;
      }`,
      [{ props: { on: true } }, { props: { on: false } }],
    );
  });

  it('passes the inputs of each view the extension draws as its JSX props do', () => {
    same(
      `<ui-vstack spacing="8">
        <ui-image systemName="tennisball.fill" size="20" color="#d7f23c" />
        <ui-progress [value]="props().done / 4" />
        <ui-gauge [value]="props().done" min="0" max="4" currentValueLabel="done" />
        <ui-divider />
        <ui-spacer [modifiers]="[frame({ height: 4 })]" />
      </ui-vstack>`,
      `(props) => {
        'widget';
        return (
          <VStack spacing={8}>
            <Image systemName="tennisball.fill" size={20} color="#d7f23c" />
            <ProgressView value={props.done / 4} />
            <Gauge value={props.done} min={0} max={4} currentValueLabel={<Text>done</Text>} />
            <Divider />
            <Spacer modifiers={[frame({ height: 4 })]} />
          </VStack>
        );
      }`,
      [{ props: { done: 1 } }],
    );
  });

  it('draws an image from a symbol, an asset and a file as its JSX does', () => {
    same(
      `<ui-hstack>
        <ui-image systemName="tennisball.fill" />
        <ui-image assetName="court" size="20" color="#d7f23c" />
        <ui-image [uiImage]="props().crest" [modifiers]="[frame({ width: 24, height: 24 })]" />
      </ui-hstack>`,
      `(props) => {
        'widget';
        return (
          <HStack>
            <Image systemName="tennisball.fill" />
            <Image assetName="court" size={20} color="#d7f23c" />
            <Image uiImage={props.crest} modifiers={[frame({ width: 24, height: 24 })]} />
          </HStack>
        );
      }`,
      [{ props: { crest: 'file:///group/crest.png' } }],
    );
  });

  it('draws a ui-chart as its JSX does, with every style it takes', () => {
    same(
      `<ui-chart
        type="line"
        showGrid
        showLegend="false"
        [animate]="false"
        [data]="props().games"
        [referenceLines]="[{ x: 'target', y: 6, color: '#d7f23c' }]"
        [lineStyle]="{ width: 2, pointStyle: 'circle', dashArray: [4, 2] }"
        [pointStyle]="{ pointStyle: 'diamond', pointSize: 6 }"
        [areaStyle]="{ color: '#0b2a5b' }"
        [barStyle]="{ cornerRadius: 4, width: 12 }"
        [pieStyle]="{ innerRadius: 0.5, angularInset: 1 }"
        [rectangleStyle]="{ color: '#ff0000', cornerRadius: 2 }"
        [ruleStyle]="{ lineWidth: 1, dashArray: [2, 2] }"
        [modifiers]="[frame({ height: 80 })]"
      />`,
      `(props) => {
        'widget';
        return (
          <Chart
            type="line"
            showGrid={true}
            showLegend={false}
            animate={false}
            data={props.games}
            referenceLines={[{ x: 'target', y: 6, color: '#d7f23c' }]}
            lineStyle={{ width: 2, pointStyle: 'circle', dashArray: [4, 2] }}
            pointStyle={{ pointStyle: 'diamond', pointSize: 6 }}
            areaStyle={{ color: '#0b2a5b' }}
            barStyle={{ cornerRadius: 4, width: 12 }}
            pieStyle={{ innerRadius: 0.5, angularInset: 1 }}
            rectangleStyle={{ color: '#ff0000', cornerRadius: 2 }}
            ruleStyle={{ lineWidth: 1, dashArray: [2, 2] }}
            modifiers={[frame({ height: 80 })]}
          />
        );
      }`,
      [
        {
          props: {
            games: [
              { x: 'Set 1', y: 6 },
              { x: 'Set 2', y: 3, color: '#8fa3c9' },
            ],
          },
        },
      ],
    );
  });

  it('layers shapes, a label and links in a ui-zstack as its JSX does', () => {
    same(
      `<ui-zstack alignment="topLeading">
        <ui-rounded-rectangle cornerRadius="16" [modifiers]="[foregroundStyle('#0b2a5b')]" />
        <ui-uneven-rounded-rectangle topLeadingRadius="4" bottomTrailingRadius="12" />
        <ui-capsule cornerStyle="continuous" />
        <ui-circle [modifiers]="[frame({ width: 8, height: 8 })]" />
        <ui-rectangle />
        <ui-ellipse />
        <ui-accessory-widget-background />
        <ui-label title="Padel" systemImage="tennisball.fill" />
        <ui-link destination="padel://score" [label]="props().us" />
        <ui-link destination="padel://match"><ui-text>Match</ui-text></ui-link>
      </ui-zstack>`,
      `(props) => {
        'widget';
        return (
          <ZStack alignment="topLeading">
            <RoundedRectangle cornerRadius={16} modifiers={[foregroundStyle('#0b2a5b')]} />
            <UnevenRoundedRectangle topLeadingRadius={4} bottomTrailingRadius={12} />
            <Capsule cornerStyle="continuous" />
            <Circle modifiers={[frame({ width: 8, height: 8 })]} />
            <Rectangle />
            <Ellipse />
            <AccessoryWidgetBackground />
            <Label title="Padel" systemImage="tennisball.fill" />
            <Link destination="padel://score" label={props.us} />
            <Link destination="padel://match"><Text>Match</Text></Link>
          </ZStack>
        );
      }`,
      [{ props: { us: '30' } }],
    );
  });
});
