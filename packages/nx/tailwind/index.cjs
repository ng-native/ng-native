/**
 * `nx g @ng-native/nx:tailwind mobile --library ui`: Tailwind in an Angular Native app, and the
 * Tailwind-styled workspace libraries it uses.
 *
 * Without it an app that uses a library's classes renders them unstyled, and nothing fails: the
 * classes are only missing from the sheet. An app needs the entry stylesheet, `withTailwind` around
 * its Metro config, the generated sheet passed to `mount` as `globalStyles`, and the packages. Each
 * library needs its classes scanned, which Tailwind does not do outside the app's directory, and its
 * theme shared:
 *
 * - Tailwind 4: the library's `theme.css` names its own sources with `@source`, relative to itself,
 *   and holds its `@theme`. The app's stylesheet imports it.
 * - Tailwind 3: the library's `tailwind.preset.cjs` lists its sources in `content`, which Tailwind 3
 *   ignores in a preset, so the app's config spreads them into its own. The app requires the preset
 *   by a relative path, which `@nx/enforce-module-boundaries` reports unless the rule allows it, as
 *   it allows the ESLint configs Nx requires the same way.
 *
 * It only adds, so running it again changes nothing, and running it with another library adds that
 * one. A file it cannot follow is left alone, with a warning saying what to add by hand.
 */
const path = require('node:path').posix;
const {
  addDependenciesToPackageJson,
  formatFiles,
  getProjects,
  installPackagesTask,
  joinPathFragments,
  logger,
  readJson,
  updateProjectConfiguration,
} = require('@nx/devkit');
const semver = require('semver');
const native = require('../native-app.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');
const { asSaved } = require('../save-exact.cjs');

const SHEET = '../.angular-native/app.tailwind.js';
const V4_IMPORTS = [
  "@import 'tailwindcss/theme.css';",
  "@import 'tailwindcss/utilities.css';",
  "@import '@ng-native/tailwind/native.css';",
];
const V3_DIRECTIVES = ['@tailwind base;', '@tailwind components;', '@tailwind utilities;'];
const PRESET_ALLOWED = String.raw`'^.*/tailwind\\.preset\\.cjs$'`;

/** The packages each version needs. Tailwind 3 ships its CLI inside `tailwindcss`. */
function packagesFor(version) {
  const own = { '@ng-native/tailwind': native.dependencies['@ng-native/components'] };
  if (version === 3) return { ...own, tailwindcss: '^3.4.1' };
  return { ...own, tailwindcss: '^4.3.3', '@tailwindcss/cli': '^4.3.3' };
}

function projectNamed(tree, name) {
  const project = getProjects(tree).get(name);
  if (!project) throw new Error(`The workspace has no project called "${name}".`);
  return project;
}

/** The app's package.json when it is a workspace package, which its dependencies go in. */
function manifestFor(tree, app) {
  const own = joinPathFragments(app.root, 'package.json');
  return usesWorkspaces(tree) ? own : 'package.json';
}

/**
 * The Tailwind major to set up: the one asked for, or the one already installed, or 4. Asking for
 * the other one than installed is an upgrade of every project using it, not a generator's call.
 */
function versionFor(tree, manifest, asked) {
  const listed = (file) => {
    if (!tree.exists(file)) return undefined;
    const { dependencies, devDependencies } = readJson(tree, file);
    return { ...devDependencies, ...dependencies }.tailwindcss;
  };
  const range = listed(manifest) ?? listed('package.json');
  const installed = range && semver.validRange(range) ? semver.minVersion(range)?.major : undefined;
  if (asked && installed && Number(asked) !== installed) {
    throw new Error(
      `The workspace has Tailwind ${installed} (${range}). Upgrade it before setting up Tailwind ` +
        `${asked}, or leave out --tailwindVersion.`,
    );
  }
  return Number(asked ?? installed ?? 4);
}

/** A warning that says what to add by hand, for a file this cannot follow. */
function byHand(file, what) {
  logger.warn(`Could not update ${file}: ${what}`);
}

function wrapMetroConfig(tree, root) {
  const file = joinPathFragments(root, 'metro.config.js');
  const config = tree.read(file, 'utf-8');
  if (config === null) return byHand(file, 'it does not exist.');
  if (config.includes('withTailwind')) return;
  const exported = /^module\.exports = (.+);$/m.exec(config);
  if (!exported) {
    return byHand(
      file,
      "wrap its export in withTailwind(config, { input: './src/styles.css' }), from " +
        "'@ng-native/tailwind/config.cjs'.",
    );
  }
  const requires = [...config.matchAll(/^const .+ = require\(.+\);$/gm)];
  const last = requires.at(-1);
  const at = last ? last.index + last[0].length : 0;
  const required = "\nconst { withTailwind } = require('@ng-native/tailwind/config.cjs');";
  const withRequire = config.slice(0, at) + required + config.slice(at);
  tree.write(
    file,
    withRequire.replace(
      exported[0],
      `module.exports = withTailwind(${exported[1]}, {\n  input: './src/styles.css',\n});`,
    ),
  );
}

function passGlobalStyles(tree, root) {
  const file = joinPathFragments(root, 'src/main.ts');
  const main = tree.read(file, 'utf-8');
  if (main === null) return byHand(file, 'it does not exist.');
  if (main.includes(SHEET)) return;
  const options = /(\bmount\([^\n]*\{\n)([ \t]*)/.exec(main);
  const imports = [...main.matchAll(/^import .+;$/gm)];
  if (!options || !imports.length || /\bglobalStyles\b/.test(main)) {
    return byHand(
      file,
      `import tailwind from '${SHEET}' and pass it to mount as { globalStyles: tailwind }.`,
    );
  }
  const last = imports.at(-1);
  const at = last.index + last[0].length;
  const imported = `${main.slice(0, at)}\nimport tailwind from '${SHEET}';${main.slice(at)}`;
  tree.write(
    file,
    imported.replace(
      options[0],
      `${options[1]}${options[2]}globalStyles: tailwind,\n${options[2]}`,
    ),
  );
}

/** The `#160` additions an app generated before them lacks: build the sheet first, and ignore it. */
function prepareForTheSheet(tree, name, app) {
  const typecheck = app.targets?.typecheck;
  const command = typecheck?.options?.command;
  if (command === 'ngc -p tsconfig.json --noEmit') {
    typecheck.options.command = native.TYPECHECK;
    updateProjectConfiguration(tree, name, app);
  } else if (typeof command === 'string' && !command.includes('metro.config.js')) {
    // One of the app's own: a fresh checkout has no sheet for main.ts to import until Metro's
    // config has been loaded once.
    byHand(
      `${name}'s typecheck target`,
      `run "node metro.config.js && " before "${command}", which builds the sheet src/main.ts imports.`,
    );
  }
  const ignore = joinPathFragments(app.root, '.gitignore');
  const text = tree.read(ignore, 'utf-8') ?? '';
  if (!/^\.angular-native\/?$/m.test(text)) {
    const lines = "# Generated by @ng-native/tailwind's withTailwind, rebuilt on every Metro start";
    tree.write(ignore, `${text.replace(/\n*$/, text ? '\n\n' : '')}${lines}\n.angular-native/\n`);
  }
}

/** The library's `theme.css` for Tailwind 4, written when it has none, and its path. */
function libraryTheme(tree, library) {
  const file = joinPathFragments(library.root, 'theme.css');
  if (!tree.exists(file)) {
    tree.write(
      file,
      [
        "/* This library's Tailwind theme, which each app using it imports. @source is relative to",
        '   this file, so the app scans the classes the library uses. */',
        "@source './src';",
        '',
        '@theme {',
        '}',
        '',
      ].join('\n'),
    );
  }
  return file;
}

/** The library's `tailwind.preset.cjs` for Tailwind 3, written when it has none, and its path. */
function libraryPreset(tree, library) {
  const file = joinPathFragments(library.root, 'tailwind.preset.cjs');
  if (!tree.exists(file)) {
    tree.write(
      file,
      [
        "// This library's Tailwind theme, and where its classes are. Tailwind 3 ignores `content` in a",
        "// preset, so each app's config spreads it into its own. The path starts from __dirname because",
        '// Tailwind resolves a relative one against the directory it runs in, which is the app.',
        "const { join } = require('path');",
        '',
        'module.exports = {',
        "  content: [join(__dirname, 'src/**/*.{ts,html}')],",
        '  theme: { extend: {} },',
        '};',
        '',
      ].join('\n'),
    );
  }
  return file;
}

function writeV4Stylesheet(tree, root, themes) {
  const file = joinPathFragments(root, 'src/styles.css');
  const existing = tree.read(file, 'utf-8');
  const lines =
    existing === null ? ["/* The app's Tailwind entry, without preflight. */", ...V4_IMPORTS] : [];
  const text = existing ?? '';
  const imports = themes
    .map((theme) => `@import '${path.relative(path.join(root, 'src'), theme)}';`)
    .filter((line) => !text.includes(line));
  if (existing !== null && imports.length === 0) return;
  tree.write(
    file,
    `${text.replace(/\n*$/, text ? '\n' : '')}${[...lines, ...imports].join('\n')}\n`,
  );
}

function writeV3Stylesheet(tree, root) {
  const file = joinPathFragments(root, 'src/styles.css');
  if (!tree.exists(file)) tree.write(file, `${V3_DIRECTIVES.join('\n')}\n`);
}

/**
 * The app's `tailwind.config.js` for Tailwind 3. One this generator wrote is written again with
 * every library it had and the new ones; any other is left alone, with a warning.
 */
function writeV3Config(tree, root, presets) {
  const file = joinPathFragments(root, 'tailwind.config.js');
  const existing = tree.read(file, 'utf-8');
  const relative = (preset) => path.relative(root, preset);
  const wanted = presets.map(relative);
  if (existing !== null) {
    if (!existing.includes(GENERATED)) {
      const missing = wanted.filter((preset) => !existing.includes(preset));
      if (missing.length) {
        byHand(file, `list ${missing.join(', ')} in presets, and spread each one's content in.`);
      }
      return;
    }
    const had = [...existing.matchAll(/require\('([^']+\/tailwind\.preset\.cjs)'\)/g)].map(
      (match) => match[1],
    );
    wanted.unshift(...had.filter((preset) => !wanted.includes(preset)));
  }
  tree.write(file, v3Config(wanted));
}

const GENERATED = '// Written by nx g @ng-native/nx:tailwind.';

function v3Config(presets) {
  const names = [];
  for (const preset of presets) {
    const base = identifier(path.basename(path.dirname(preset)));
    let name = base;
    for (let n = 2; names.includes(name); n++) name = `${base}${n}`;
    names.push(name);
  }
  const requires = presets.map((preset, i) => `const ${names[i]} = require('${preset}');`);
  const native = presets.length
    ? "{ ...require('@ng-native/tailwind/preset.cjs'), presets: [] }"
    : "require('@ng-native/tailwind/preset.cjs')";
  const content = ["'./src/**/*.{ts,html}'", ...names.map((name) => `...${name}.content`)];
  // Only the first preset brings Tailwind's defaults: a later one's would override its theme.
  const listed = names.map((name, i) => (i === 0 ? name : `{ ...${name}, presets: [] }`));
  return [
    GENERATED,
    ...(presets.length
      ? [
          '// The first preset brings Tailwind defaults; each after it takes presets: [] so it does not',
          '// bring them again over the themes before it.',
        ]
      : []),
    ...requires,
    ...(requires.length ? [''] : []),
    'module.exports = {',
    `  presets: [${[...listed, native].join(', ')}],`,
    `  content: [${content.join(', ')}],`,
    '};',
    '',
  ].join('\n');
}

/** A JavaScript name for a library's preset: `ui`, `sharedUi`. */
function identifier(name) {
  const camel = name.replace(/[^a-zA-Z0-9]+(.)/g, (_, next) => next.toUpperCase());
  return /^[a-zA-Z_$]/.test(camel) ? camel : `_${camel}`;
}

/** Adds the preset's file name to `@nx/enforce-module-boundaries`' `allow` list, where there is one. */
function allowPresets(tree) {
  const file = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs'].find((name) =>
    tree.exists(name),
  );
  if (!file) return;
  const config = tree.read(file, 'utf-8') ?? '';
  if (!config.includes('enforce-module-boundaries') || config.includes('tailwind\\\\.preset'))
    return;
  const start = /allow:\s*\[/.exec(config);
  const end = start ? closingBracket(config, start.index + start[0].length) : -1;
  if (!start || end < 0) {
    return byHand(file, `add ${PRESET_ALLOWED} to @nx/enforce-module-boundaries' allow list.`);
  }
  const open = start.index + start[0].length;
  const entries = config.slice(open, end).trimEnd();
  const list = entries.trim() ? `${entries.replace(/,$/, '')}, ${PRESET_ALLOWED}` : PRESET_ALLOWED;
  tree.write(file, config.slice(0, open) + list + config.slice(end));
}

/** The index of the `]` closing the array that starts at `from`, skipping strings. */
function closingBracket(text, from) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '[') depth++;
    else if (char === ']' && depth-- === 0) return i;
  }
  return -1;
}

async function addPackages(tree, manifest, version) {
  const wanted = packagesFor(version);
  const own = manifest === 'package.json' ? readJson(tree, manifest) : readJson(tree, manifest);
  const installed = Object.keys({ ...own.dependencies, ...own.devDependencies });
  const ranges =
    manifest === 'package.json'
      ? wanted
      : native.reuseRootRanges(wanted, readJson(tree, 'package.json'));
  addDependenciesToPackageJson(tree, {}, await asSaved(tree, ranges, installed), manifest, true);
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ project: string, tailwindVersion?: 3 | 4, library?: string, skipInstall?: boolean, skipFormat?: boolean }} options
 */
async function tailwind(tree, options) {
  const app = projectNamed(tree, options.project);
  const appJson = joinPathFragments(app.root, 'app.json');
  const metro = joinPathFragments(app.root, 'metro.config.js');
  if (!tree.exists(appJson) || !tree.exists(metro)) {
    throw new Error(
      `${options.project} is not an Angular Native app: it has no app.json and metro.config.js. ` +
        'Generate one with nx g @ng-native/nx:app.',
    );
  }
  const libraries = (options.library ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => projectNamed(tree, name));
  const manifest = manifestFor(tree, app);
  const version = versionFor(tree, manifest, options.tailwindVersion);

  if (version === 3) {
    writeV3Stylesheet(tree, app.root);
    writeV3Config(
      tree,
      app.root,
      libraries.map((library) => libraryPreset(tree, library)),
    );
    if (libraries.length) allowPresets(tree);
  } else {
    writeV4Stylesheet(
      tree,
      app.root,
      libraries.map((library) => libraryTheme(tree, library)),
    );
  }
  wrapMetroConfig(tree, app.root);
  passGlobalStyles(tree, app.root);
  prepareForTheSheet(tree, options.project, app);
  await addPackages(tree, manifest, version);

  if (!options.skipFormat) await formatFiles(tree);
  if (options.skipInstall) return () => {};
  return () => installPackagesTask(tree, true);
}

module.exports = { tailwind };
