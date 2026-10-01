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
 * A project with a Vite config that runs `ngNativeWeb()` also builds for a browser, beside the
 * device build or on its own, and the browser takes the web preset in place of the native one:
 *
 * - Tailwind 4: a stylesheet importing `@ng-native/tailwind/web.css` (`src/styles.web.css` beside a
 *   device build, whose `src/styles.css` imports `native.css`), and `@tailwindcss/vite`'s plugin
 *   after `ngNativeWeb()`.
 * - Tailwind 3: a config with `web-preset.cjs` (`tailwind.web.config.js` beside a device build,
 *   taking the rest from its `tailwind.config.js`), and the PostCSS config Vite runs it from.
 *
 * `index.html` links the stylesheet.
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
const V4_BASE = ["@import 'tailwindcss/theme.css';", "@import 'tailwindcss/utilities.css';"];
const V4_IMPORTS = [...V4_BASE, "@import '@ng-native/tailwind/native.css';"];
const V4_WEB_IMPORTS = [...V4_BASE, "@import '@ng-native/tailwind/web.css';"];
const VITE_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `vite.config.${ext}`);
const POSTCSS_CONFIGS = [
  ...['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((ext) => `postcss.config.${ext}`),
  ...['', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs'].map((ext) => `.postcssrc${ext}`),
];
const V3_DIRECTIVES = ['@tailwind base;', '@tailwind components;', '@tailwind utilities;'];
const PRESET_ALLOWED = String.raw`'^.*/tailwind\\.preset\\.cjs$'`;

/**
 * The packages each version needs, for a device build, a web build or both. Metro runs Tailwind
 * 4's CLI and Vite its plugin. Tailwind 3 ships its CLI inside `tailwindcss`, and Vite runs it
 * through PostCSS.
 */
function packagesFor(version, { device, web }) {
  const own = { '@ng-native/tailwind': native.dependencies['@ng-native/components'] };
  if (version === 3) return { ...own, tailwindcss: '^3.4.1' };
  return {
    ...own,
    tailwindcss: '^4.3.3',
    ...(device ? { '@tailwindcss/cli': '^4.3.3' } : {}),
    ...(web ? { '@tailwindcss/vite': '^4.3.3' } : {}),
  };
}

/** The project's Vite config, when it builds for a browser with `ngNativeWeb()`. */
function viteConfig(tree, root) {
  return VITE_CONFIGS.map((name) => joinPathFragments(root, name)).find((file) =>
    tree.read(file, 'utf-8')?.includes('ngNativeWeb'),
  );
}

function projectNamed(tree, name) {
  const project = getProjects(tree).get(name);
  if (!project) throw new Error(`The workspace has no project called "${name}".`);
  return project;
}

/** The app's package.json when it is a workspace package, which its dependencies go in. */
function manifestFor(tree, app) {
  const own = joinPathFragments(app.root, 'package.json');
  return usesWorkspaces(tree) && tree.exists(own) ? own : 'package.json';
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

/**
 * A Tailwind 4 entry stylesheet with `base` (the native or the web preset's imports) when it is
 * new, and an import of each library's theme it lacks, after the imports it has.
 */
function writeV4Stylesheet(tree, file, base, themes) {
  const existing = tree.read(file, 'utf-8');
  const lines =
    existing === null ? ["/* The app's Tailwind entry, without preflight. */", ...base] : [];
  const text = existing ?? '';
  const imports = themes
    .map((theme) => `@import '${path.relative(path.dirname(file), theme)}';`)
    .filter((line) => !text.includes(line));
  if (existing !== null && imports.length === 0) return;
  const last = [...text.matchAll(/^@import .+;$/gm)].at(-1);
  const at = last ? last.index + last[0].length + 1 : text.length;
  const before = text.slice(0, at).replace(/\n*$/, at ? '\n' : '');
  tree.write(file, `${before}${[...lines, ...imports].join('\n')}\n${text.slice(at)}`);
}

/**
 * The web build's Tailwind 4 stylesheet. One the app has already, without Tailwind, gets the web
 * preset's imports ahead of its rules, where CSS requires an `@import`.
 */
function writeWebV4Stylesheet(tree, file, themes) {
  const existing = tree.read(file, 'utf-8');
  if (existing !== null && !existing.includes('@ng-native/tailwind/web.css')) {
    if (existing.includes('tailwindcss')) {
      return byHand(
        file,
        `import '@ng-native/tailwind/web.css' after Tailwind's theme and utilities.`,
      );
    }
    tree.write(file, `${V4_WEB_IMPORTS.join('\n')}\n\n${existing}`);
  }
  writeV4Stylesheet(tree, file, V4_WEB_IMPORTS, themes);
}

/** Adds `tailwindcss()` from `@tailwindcss/vite` after `ngNativeWeb()` in the Vite config. */
function addVitePlugin(tree, file) {
  const config = tree.read(file, 'utf-8') ?? '';
  if (config.includes('@tailwindcss/vite')) return;
  const call = /\bngNativeWeb\(/.exec(config);
  const end = call ? closingBracket(config, call.index + call[0].length, '(', ')') : -1;
  const last = [...config.matchAll(/^import .+;$/gm)].at(-1);
  if (end < 0 || !last) {
    return byHand(
      file,
      "import tailwindcss from '@tailwindcss/vite' and add tailwindcss() after ngNativeWeb() in its plugins.",
    );
  }
  const at = last.index + last[0].length;
  tree.write(
    file,
    `${config.slice(0, at)}\nimport tailwindcss from '@tailwindcss/vite';` +
      `${config.slice(at, end + 1)}, tailwindcss()${config.slice(end + 1)}`,
  );
}

/** Whether `code` names `file` in a string, in either quote. */
function mentions(code, file) {
  return code.includes(`'${file}'`) || code.includes(`"${file}"`);
}

/**
 * Links `stylesheet` from the `index.html` Vite serves, which builds it with the page. A link
 * rather than an import from the entry, which TypeScript 6 refuses in an app whose types do not
 * declare `.css` modules, as a native app's do not. One the entry imports already is left as is.
 */
function linkStylesheet(tree, root, stylesheet) {
  const file = joinPathFragments(root, 'index.html');
  const html = tree.read(file, 'utf-8') ?? '';
  const href = `/${path.relative(root, stylesheet)}`;
  const script = /<script\b[^>]*\btype=["']module["'][^>]*>/.exec(html);
  const src = script && /\bsrc=["']([^"']+)["']/.exec(script[0]);
  const entry = src && joinPathFragments(root, src[1].replace(/^\.?\//, ''));
  const relative = entry && path.relative(path.dirname(entry), stylesheet);
  const imported = relative && (relative.startsWith('.') ? relative : `./${relative}`);
  if (mentions(html, href) || (imported && mentions(tree.read(entry, 'utf-8') ?? '', imported))) {
    return;
  }
  const head = /^([ \t]*)<\/head>/m.exec(html);
  const link = `<link rel="stylesheet" href="${href}" />`;
  if (!head) return byHand(file, `add ${link} to its head.`);
  const indent = `${head[1]}  `;
  tree.write(file, `${html.slice(0, head.index)}${indent}${link}\n${html.slice(head.index)}`);
}

function writeV3Stylesheet(tree, root) {
  const file = joinPathFragments(root, 'src/styles.css');
  if (!tree.exists(file)) tree.write(file, `${V3_DIRECTIVES.join('\n')}\n`);
}

/**
 * A Tailwind 3 config: the app's `tailwind.config.js`, or the web build's. One this generator
 * wrote is written again with every library it had and the new ones; any other is left alone,
 * with a warning.
 */
function writeV3Config(tree, file, presets, options) {
  const existing = tree.read(file, 'utf-8');
  const relative = (preset) => path.relative(path.dirname(file), preset);
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
  tree.write(file, v3Config(wanted, options));
}

const GENERATED = '// Written by nx g @ng-native/nx:tailwind.';

/**
 * A config listing `presets` ahead of Angular Native's `preset`. With `extend`, it is the config
 * that file holds with the presets swapped, and takes its `content` from it.
 */
function v3Config(presets, { preset = 'preset.cjs', extend } = {}) {
  const names = [];
  for (const preset of presets) {
    const base = identifier(path.basename(path.dirname(preset)));
    let name = base;
    for (let n = 2; names.includes(name); n++) name = `${base}${n}`;
    names.push(name);
  }
  const requires = presets.map((preset, i) => `const ${names[i]} = require('${preset}');`);
  const own = `require('@ng-native/tailwind/${preset}')`;
  const native = presets.length ? `{ ...${own}, presets: [] }` : own;
  const content = ["'./src/**/*.{ts,html}'", ...names.map((name) => `...${name}.content`)];
  // Only the first preset brings Tailwind's defaults: a later one's would override its theme.
  const listed = names.map((name, i) => (i === 0 ? name : `{ ...${name}, presets: [] }`));
  return [
    GENERATED,
    ...(extend
      ? [
          "// The web build's config: the app's own, with the web preset in place of the native one.",
        ]
      : []),
    ...(presets.length
      ? [
          '// The first preset brings Tailwind defaults; each after it takes presets: [] so it does not',
          '// bring them again over the themes before it.',
        ]
      : []),
    ...requires,
    ...(requires.length ? [''] : []),
    'module.exports = {',
    ...(extend ? [`  ...require('${extend}'),`] : []),
    `  presets: [${[...listed, native].join(', ')}],`,
    ...(extend ? [] : [`  content: [${content.join(', ')}],`]),
    '};',
    '',
  ].join('\n');
}

/**
 * The PostCSS config Vite runs Tailwind 3 from, pointed at `config`. One the app has already is
 * left alone, with a warning when it does not run Tailwind.
 */
function writePostcssConfig(tree, root, config, ext) {
  const existing = POSTCSS_CONFIGS.map((name) => joinPathFragments(root, name)).find((file) =>
    tree.exists(file),
  );
  if (existing) {
    if (!tree.read(existing, 'utf-8')?.includes('tailwindcss')) {
      byHand(existing, `add tailwindcss: { config: './${config}' } to its plugins.`);
    }
    return;
  }
  tree.write(
    joinPathFragments(root, `postcss.config.${ext}`),
    [
      '// Vite runs Tailwind 3 as a PostCSS plugin.',
      'module.exports = {',
      `  plugins: { tailwindcss: { config: './${config}' } },`,
      '};',
      '',
    ].join('\n'),
  );
}

/**
 * `cjs` where a `.js` file would be an ES module, which a `module.exports` config cannot be: in a
 * package whose nearest `package.json` says `"type": "module"`.
 */
function commonJsExtension(tree, root) {
  for (let dir = root; ; dir = path.dirname(dir)) {
    const manifest = joinPathFragments(dir, 'package.json');
    if (tree.exists(manifest)) return readJson(tree, manifest).type === 'module' ? 'cjs' : 'js';
    if (dir === '.' || dir === '' || dir === '/') return 'js';
  }
}

/**
 * The web build, from the Vite config that runs `ngNativeWeb()`. Beside a device build, Tailwind
 * 4 takes a stylesheet of its own, since the device's imports `native.css`, and Tailwind 3 a
 * config of its own that swaps the preset in the device's.
 */
function setUpWeb(tree, root, vite, version, libraries, besideDevice) {
  if (version === 3) {
    const ext = commonJsExtension(tree, root);
    const config = besideDevice ? `tailwind.web.config.${ext}` : `tailwind.config.${ext}`;
    writeV3Config(
      tree,
      joinPathFragments(root, config),
      libraries.map((library) => libraryPreset(tree, library)),
      { preset: 'web-preset.cjs', extend: besideDevice ? `./tailwind.config.${ext}` : undefined },
    );
    writePostcssConfig(tree, root, config, ext);
    writeV3Stylesheet(tree, root);
    return linkStylesheet(tree, root, joinPathFragments(root, 'src/styles.css'));
  }
  const file = joinPathFragments(root, besideDevice ? 'src/styles.web.css' : 'src/styles.css');
  writeWebV4Stylesheet(
    tree,
    file,
    libraries.map((library) => libraryTheme(tree, library)),
  );
  addVitePlugin(tree, vite);
  linkStylesheet(tree, root, file);
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
  const end = start ? closingBracket(config, start.index + start[0].length, '[', ']') : -1;
  if (!start || end < 0) {
    return byHand(file, `add ${PRESET_ALLOWED} to @nx/enforce-module-boundaries' allow list.`);
  }
  const open = start.index + start[0].length;
  const entries = config.slice(open, end).trimEnd();
  const list = entries.trim() ? `${entries.replace(/,$/, '')}, ${PRESET_ALLOWED}` : PRESET_ALLOWED;
  tree.write(file, config.slice(0, open) + list + config.slice(end));
}

/** The index of the `close` ending the bracket that starts at `from`, skipping strings. */
function closingBracket(text, from, open, close) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === open) depth++;
    else if (char === close && depth-- === 0) return i;
  }
  return -1;
}

async function addPackages(tree, manifest, version, builds) {
  const wanted = packagesFor(version, builds);
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
  const device =
    tree.exists(joinPathFragments(app.root, 'app.json')) &&
    tree.exists(joinPathFragments(app.root, 'metro.config.js'));
  const vite = viteConfig(tree, app.root);
  if (!device && !vite) {
    throw new Error(
      `${options.project} is not an Angular Native app: it has no app.json and metro.config.js, ` +
        'and no Vite config with ngNativeWeb(). Generate one with nx g @ng-native/nx:app.',
    );
  }
  const libraries = (options.library ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => projectNamed(tree, name));
  const manifest = manifestFor(tree, app);
  const version = versionFor(tree, manifest, options.tailwindVersion);

  if (device) {
    if (version === 3) {
      writeV3Stylesheet(tree, app.root);
      writeV3Config(
        tree,
        joinPathFragments(app.root, `tailwind.config.${commonJsExtension(tree, app.root)}`),
        libraries.map((library) => libraryPreset(tree, library)),
      );
    } else {
      writeV4Stylesheet(
        tree,
        joinPathFragments(app.root, 'src/styles.css'),
        V4_IMPORTS,
        libraries.map((library) => libraryTheme(tree, library)),
      );
    }
    wrapMetroConfig(tree, app.root);
    passGlobalStyles(tree, app.root);
    prepareForTheSheet(tree, options.project, app);
  }
  if (vite) setUpWeb(tree, app.root, vite, version, libraries, device);
  if (version === 3 && libraries.length) allowPresets(tree);
  await addPackages(tree, manifest, version, { device, web: Boolean(vite) });

  if (!options.skipFormat) await formatFiles(tree);
  if (options.skipInstall) return () => {};
  return () => installPackagesTask(tree, true);
}

module.exports = { tailwind };
