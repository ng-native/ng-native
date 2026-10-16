/**
 * Whether each prop a typed `ui-*` component sends is one `@expo/ui`'s native view declares.
 *
 * A native view ignores a prop it does not declare, and the engine's development check covers
 * ng-native's own primitives only, so a prop `@expo/ui` renames or removes stops working with no
 * error anywhere: 57.0.23 split `RNHostView`'s `matchContents` into one prop per axis, and every
 * `ui-view-host` lost its size. This reads the props each component binds on its host, from
 * `packages/expo/src/expo-ui-components.ts`, the native view each element is, from `EXPO_UI_VIEWS`,
 * and what that view declares, from `@expo/ui`'s Swift (`@Field var`, `Prop("...")`) and Kotlin
 * (a props data class's parameters, `Prop("...")`) sources, per platform.
 *
 * It reads source text, so it fails when it finds nothing to compare rather than passing: a change
 * in how `@expo/ui` declares props must not read as every prop being fine.
 *
 * Usage:
 *
 *   node scripts/expo-ui-native-props.mjs              # the @expo/ui this workspace installs
 *   node scripts/expo-ui-native-props.mjs --latest     # the newest @expo/ui the peer range allows
 *   node scripts/expo-ui-native-props.mjs <directory>  # an unpacked @expo/ui package
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expoPackage = path.join(root, 'packages/expo');

/**
 * Props a component sends in more than one form, each form for the `@expo/ui` versions that read
 * it: the check passes when every prop of one form is declared. `ui-view-host`'s `matchContents`
 * became one prop per axis in 57.0.23, and it sends both.
 */
const FORMS = {
  'view-host': [['matchContents'], ['matchContentsHorizontal', 'matchContentsVertical']],
};

/**
 * Divergences already there, as `<element> <prop> <platform>` or `<element> view <platform>`, each
 * with the reason it stays, or to be fixed or stopped in #924. A new one fails. One of these that native declares
 * comes back as `stale`: `expo-ui-native-props.test.ts` fails on it for the version this workspace
 * installs, so the list can't go stale, and a run here only notes it, since an entry can be known
 * for a newer `@expo/ui` than the one it reads.
 */
const KNOWN = new Set([
  // A widget layout's view. @expo/ui 57.0.22 moved it out of the app, where it had no effect, and
  // expo-widgets 57.0.23 draws it in the widget extension, which a layout's build compiles it for.
  'accessory-widget-background view ios',
  'button label android',
  'button role android',
  'button systemImage android',
  'date-picker accessibilityLabel android',
  'date-picker range android',
  'date-picker title android',
  'host ignoreSafeArea android',
  'image assetName android',
  'image systemName android',
  'image uiImage android',
  'menu label android',
  'menu systemImage android',
  'slot extraProps android',
  'toggle label android',
]);

/** Every file under `directory` whose name ends with `extension`. */
function filesIn(directory, extension) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) found.push(...filesIn(file, extension));
    else if (name.endsWith(extension)) found.push(file);
  }
  return found;
}

/** The text from the bracket at `open` to the one that closes it, both included. */
function enclosed(text, open) {
  const closing = { '{': '}', '(': ')' }[text[open]];
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === text[open]) depth++;
    else if (text[at] === closing && --depth === 0) return text.slice(open, at + 1);
  }
  return text.slice(open);
}

/**
 * The props each typed `ui-*` component binds on its host, by element, each with the platforms it
 * is sent on: `android ? undefined : x` only on iOS, `android ? x : undefined` only on Android.
 */
export function componentProps(source) {
  const components = new Map();
  for (const match of source.matchAll(/@Component\(\{/g)) {
    const decorator = enclosed(source, match.index + '@Component('.length);
    const selector = /selector:\s*'ui-([\w-]+)'/.exec(decorator)?.[1];
    const hostAt = decorator.search(/host:\s*\{/);
    if (!selector || hostAt === -1) continue;
    const host = enclosed(decorator, decorator.indexOf('{', hostAt));
    const props = components.get(selector) ?? new Map();
    for (const [, name, expression] of host.matchAll(/'\[(\w+)\]':\s*'([^']*)'/g)) {
      const platforms = /^android \? undefined :/.test(expression)
        ? ['ios']
        : /^android \? .+ : undefined$/.test(expression)
          ? ['android']
          : ['ios', 'android'];
      props.set(name, platforms);
    }
    components.set(selector, props);
  }
  return components;
}

/** The `Prop("...")` names declared in each `View(...) { ... }` block of a module, by view. */
function moduleProps(text, view) {
  const props = new Map();
  for (const match of text.matchAll(view)) {
    const after = match.index + match[0].length;
    if (!/^\s*\{/.test(text.slice(after))) continue;
    const block = enclosed(text, text.indexOf('{', after));
    const names = props.get(match[1]) ?? new Set();
    for (const [, name] of block.matchAll(/\bProp\("(\w+)"/g)) names.add(name);
    props.set(match[1], names);
  }
  return props;
}

/** `views`, with `more`'s names added to each view's. */
function merged(views, more) {
  for (const [view, names] of more)
    views.set(view, new Set([...(views.get(view) ?? []), ...names]));
  return views;
}

/** Each SwiftUI view `@expo/ui` declares, with the props it reads. */
export function iosViews(expoUi) {
  const text = filesIn(path.join(expoUi, 'ios'), '.swift')
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const classes = new Map();
  for (const match of text.matchAll(/class\s+(\w+)\s*:\s*([\w.]+)[^{]*\{/g)) {
    const body = enclosed(text, match.index + match[0].length - 1);
    const fields = body.matchAll(
      /@Field(?:\([^)]*\))?\s+(?:(?:public|internal|private|open)\s+)?var\s+(\w+)/g,
    );
    classes.set(match[1], { parent: match[2], fields: new Set([...fields].map((m) => m[1])) });
  }
  const fieldsOf = (name, seen = new Set()) => {
    const found = classes.get(name);
    if (!found || seen.has(name)) return [];
    seen.add(name);
    return [...found.fields, ...fieldsOf(found.parent, seen)];
  };
  const views = new Map();
  for (const match of text.matchAll(/struct\s+(\w+)\s*:\s*ExpoSwiftUI\.\w+[^{]*\{/g)) {
    const body = enclosed(text, match.index + match[0].length - 1);
    const propsClass = /var\s+props\s*:\s*(\w+)/.exec(body)?.[1];
    if (propsClass) views.set(match[1], new Set(fieldsOf(propsClass)));
  }
  return merged(views, moduleProps(text, /\b(?:ExpoUI)?View\((\w+)\.self\)/g));
}

/** Each Compose view `@expo/ui` declares, with the props it reads. */
export function androidViews(expoUi) {
  const text = filesIn(path.join(expoUi, 'android/src/main'), '.kt')
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const dataClasses = new Map();
  for (const match of text.matchAll(/data\s+class\s+(\w+)\s*\(/g)) {
    const parameters = enclosed(text, match.index + match[0].length - 1);
    const names = [...parameters.matchAll(/\b(?:val|var)\s+(\w+)\s*:/g)].map((m) => m[1]);
    dataClasses.set(match[1], new Set(names));
  }
  const views = new Map();
  for (const [, props, name] of text.matchAll(/ExpoUIView<(\w+)>\("(\w+)"\)/g)) {
    views.set(name, new Set(dataClasses.get(props) ?? []));
  }
  for (const [, view, props] of text.matchAll(
    /class\s+(\w+)\s*\([^)]*\)\s*:\s*\w*ComposeView<(\w+)>/gs,
  )) {
    merged(views, new Map([[view, dataClasses.get(props) ?? new Set()]]));
  }
  merged(views, moduleProps(text, /\bView\((\w+)::class\)/g));
  return merged(views, moduleProps(text, /\bExpoUIView<\w+>\("(\w+)"\)/g));
}

/**
 * What one element sends on one platform that `names`, its native view's declared props, lacks:
 * `report` takes each with its `KNOWN` key, `found` the ones no key can excuse.
 */
function checkView({ element, platform, view, props, names }, report, found) {
  const forms = FORMS[element] ?? [];
  if (forms.length && !forms.some((form) => form.every((prop) => names.has(prop)))) {
    const options = forms.map((form) => form.join(' and ')).join(', or ');
    found.push(`<ui-${element}> sends ${options} on ${platform}, and ${view} declares none.`);
  }
  for (const [prop, platforms] of props) {
    if (forms.some((form) => form.includes(prop))) continue;
    if (platforms.includes(platform) && !names.has(prop)) {
      report(
        `${element} ${prop} ${platform}`,
        `<ui-${element}> sends '${prop}' on ${platform}, which ${view} does not declare.`,
      );
    }
  }
}

/** The native views `@expo/ui` at `expoUi` declares, on each platform, failing on too few. */
function declaredViews(expoUi) {
  const declared = { ios: iosViews(expoUi), android: androidViews(expoUi) };
  for (const platform of ['ios', 'android']) {
    if (declared[platform].size < 10) {
      throw new Error(
        `Found ${declared[platform].size} ${platform} views in ${expoUi}: did @expo/ui change how it declares them?`,
      );
    }
  }
  return declared;
}

/**
 * Each prop a typed `ui-*` component sends that its native view does not declare, and each view
 * `EXPO_UI_VIEWS` names that `@expo/ui` does not have, as sentences, leaving out `KNOWN` ones; and
 * the `KNOWN` ones this `@expo/ui` does declare, as `stale`.
 */
export async function divergences(
  expoUi,
  source = readFileSync(path.join(expoPackage, 'src/expo-ui-components.ts'), 'utf8'),
) {
  const { EXPO_UI_VIEWS } = await import(path.join(expoPackage, 'src/expo-ui.ts'));
  const components = componentProps(source);
  const declared = declaredViews(expoUi);
  if (components.size < 10) throw new Error(`Found ${components.size} typed ui-* components.`);
  const bound = [...components.values()].reduce((count, props) => count + props.size, 0);
  if (bound < 50) {
    throw new Error(`Found ${bound} host bindings: did the components change how they write them?`);
  }
  const found = [];
  const seen = new Set();
  const report = (key, sentence) => {
    seen.add(key);
    if (!KNOWN.has(key)) found.push(sentence);
  };
  for (const [element, props] of components) {
    const views = EXPO_UI_VIEWS[element];
    if (!views) {
      found.push(`<ui-${element}> is not in EXPO_UI_VIEWS.`);
      continue;
    }
    for (const [index, platform] of ['ios', 'android'].entries()) {
      const view = views[index];
      const names = view && declared[platform].get(view);
      if (names) checkView({ element, platform, view, props, names }, report, found);
      else if (view) {
        report(
          `${element} view ${platform}`,
          `<ui-${element}> is ${platform}'s ${view}, which @expo/ui does not declare.`,
        );
      }
    }
  }
  return { found, stale: [...KNOWN].filter((key) => !seen.has(key)) };
}

/** The newest `@expo/ui` the package's peer range allows, unpacked into a temporary directory. */
function latest() {
  const range = JSON.parse(readFileSync(path.join(expoPackage, 'package.json'), 'utf8'))
    .peerDependencies['@expo/ui'];
  const directory = mkdtempSync(path.join(tmpdir(), 'expo-ui-'));
  const packed = execFileSync('npm', ['pack', `@expo/ui@${range}`, '--silent'], {
    cwd: directory,
    encoding: 'utf8',
  });
  execFileSync('tar', ['-xzf', packed.trim().split('\n').at(-1)], { cwd: directory });
  return { directory, expoUi: path.join(directory, 'package') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = process.argv[2];
  const fresh = argument === '--latest' ? latest() : null;
  const installed = () =>
    path.dirname(
      createRequire(path.join(expoPackage, 'package.json')).resolve('@expo/ui/package.json'),
    );
  const expoUi = fresh?.expoUi ?? argument ?? installed();
  try {
    const { version } = JSON.parse(readFileSync(path.join(expoUi, 'package.json'), 'utf8'));
    const { found, stale } = await divergences(expoUi);
    const summary = found.length
      ? `@expo/ui ${version}: ${found.length} prop(s) the native views do not declare:`
      : `@expo/ui ${version}: every prop a ui-* component sends is declared, or known.`;
    if (found.length) {
      console.error(summary);
      for (const line of found) console.error(`  ${line}`);
      process.exitCode = 1;
    } else {
      console.log(summary);
    }
    // The job summary the Latest versions workflow's failure issue points at.
    if (process.env['GITHUB_STEP_SUMMARY']) {
      const lines = [summary, ...found.map((line) => `- ${line}`)].join('\n');
      appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${lines}\n`);
    }
    // Known for the pinned version, and declared in this one: a note, since a newer @expo/ui
    // declaring a prop is good news rather than a failure.
    if (stale.length) console.log(`Known, and declared in ${version}: ${stale.join(', ')}`);
  } finally {
    if (fresh) rmSync(fresh.directory, { recursive: true, force: true });
  }
}
