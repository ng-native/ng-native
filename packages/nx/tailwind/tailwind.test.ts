/**
 * `nx g @ng-native/nx:tailwind <app>`: an app generated without Tailwind, set up for it, and for
 * the Tailwind-styled libraries it uses.
 *
 * An app that uses a library's classes without this renders them unstyled, with nothing failing:
 * tests, typecheck, lint and export all pass.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const {
  addProjectConfiguration,
  readJson,
  readProjectConfiguration,
  updateJson,
  updateProjectConfiguration,
} = require('@nx/devkit') as typeof import('@nx/devkit');
const { application } = require('../application/index.cjs');
const { tailwind } = require('./index.cjs');
const native = require('../native-app.cjs');
const { registry } = require('../save-exact.cjs') as {
  registry: { versions: (name: string, cwd: string) => Promise<string[]> };
};

// No test reaches the registry: a lookup that is not stubbed fails, as it does offline.
registry.versions = async () => {
  throw new Error('offline');
};

const V4_IMPORTS = [
  "@import 'tailwindcss/theme.css';",
  "@import 'tailwindcss/utilities.css';",
  "@import '@ng-native/tailwind/native.css';",
];

/** The `angular-monorepo` preset's shape, with an app and a library in it. */
async function integrated() {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    dependencies: { '@angular/core': '~22.2.0' },
    devDependencies: { nx: '23.2.0' },
  }));
  tree.write('.gitignore', 'node_modules\n');
  await application(tree, { directory: 'apps/mobile', skipFormat: true, skipInstall: true });
  library(tree, 'ui', 'packages/ui');
  library(tree, 'tokens', 'packages/tokens');
  return tree;
}

/** The TypeScript preset's shape: pnpm workspaces, the app a workspace package. */
async function workspaces() {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    devDependencies: { nx: '23.2.0' },
  }));
  tree.delete('tsconfig.base.json');
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  await application(tree, { directory: 'apps/mobile', skipFormat: true, skipInstall: true });
  return tree;
}

function library(tree: Tree, name: string, root: string) {
  addProjectConfiguration(tree, name, { root, sourceRoot: `${root}/src`, projectType: 'library' });
  tree.write(`${root}/src/index.ts`, 'export {};\n');
}

/**
 * A browser build of `root`, as the web page sets one up: a Vite config with `ngNativeWeb()`, and
 * an `index.html` whose module script is `entry`.
 */
function web(tree: Tree, root: string, entry: string) {
  tree.write(
    `${root}/vite.config.ts`,
    [
      "import { ngNativeWeb } from '@ng-native/web/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({',
      '  plugins: [ngNativeWeb()],',
      '});',
      '',
    ].join('\n'),
  );
  tree.write(
    `${root}/index.html`,
    `<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/${entry}"></script>\n  </body>\n</html>\n`,
  );
  tree.write(
    `${root}/${entry}`,
    "import { mount } from '@ng-native/web';\nimport { App } from './app/app.ts';\n\nmount(document.getElementById('root')!, App);\n",
  );
}

/** A browser app of its own, beside the native one: a Vite project with no app.json. */
function webApp(tree: Tree, root = 'apps/site') {
  addProjectConfiguration(tree, 'site', {
    root,
    sourceRoot: `${root}/src`,
    projectType: 'application',
  });
  web(tree, root, 'src/main.ts');
  return root;
}

/** Runs `run`, and returns what it warned. */
async function warningsOf(run: () => Promise<unknown>) {
  const warnings: string[] = [];
  const { logger } = require('@nx/devkit') as typeof import('@nx/devkit');
  const warn = logger.warn;
  logger.warn = (message: unknown) => void warnings.push(String(message));
  try {
    await run();
  } finally {
    logger.warn = warn;
  }
  return warnings;
}

const generate = (tree: Tree, options: object) =>
  tailwind(tree, { project: 'mobile', skipFormat: true, skipInstall: true, ...options });

const read = (tree: Tree, file: string) => tree.read(file, 'utf-8') ?? '';

/** Every file in the tree, as text, to compare a run with the one before. */
function snapshot(tree: Tree) {
  return Object.fromEntries(
    tree.listChanges().map((change) => [change.path, change.content?.toString() ?? null]),
  );
}

describe('Tailwind 4, by default', () => {
  it("writes the app's entry stylesheet, without preflight", async () => {
    const tree = await integrated();
    await generate(tree, {});
    assert.equal(
      read(tree, 'apps/mobile/src/styles.css').trim().split('\n').slice(-3).join('\n'),
      V4_IMPORTS.join('\n'),
    );
  });

  it("wraps the Metro config in withTailwind, outside Angular Native's preset", async () => {
    const tree = await integrated();
    await generate(tree, {});
    const config = read(tree, 'apps/mobile/metro.config.js');
    assert.match(
      config,
      /const \{ withTailwind \} = require\('@ng-native\/tailwind\/config\.cjs'\);/,
    );
    assert.match(
      config,
      /module\.exports = withTailwind\(withAngularNative\(withNxMetro\(getDefaultConfig\(__dirname\)\)\), \{\n {2}input: '\.\/src\/styles\.css',\n\}\);/,
    );
  });

  it('passes the generated sheet to mount as the global stylesheet', async () => {
    const tree = await integrated();
    await generate(tree, {});
    const main = read(tree, 'apps/mobile/src/main.ts');
    assert.match(main, /^import tailwind from '\.\.\/\.angular-native\/app\.tailwind\.js';$/m);
    assert.match(
      main,
      /mount\(Number\(rootTag\), App, getFabricUIManager\(\), \{\n {4}globalStyles: tailwind,\n/,
    );
  });

  it('adds the packages at the root of an integrated workspace', async () => {
    const tree = await integrated();
    await generate(tree, {});
    const { devDependencies } = readJson(tree, 'package.json');
    assert.equal(
      devDependencies['@ng-native/tailwind'],
      native.dependencies['@ng-native/components'],
    );
    assert.equal(devDependencies.tailwindcss, '^4.3.3');
    assert.equal(devDependencies['@tailwindcss/cli'], '^4.3.3');
  });

  it("adds them to the app's own package.json with package-manager workspaces", async () => {
    const tree = await workspaces();
    await generate(tree, { project: readJson(tree, 'apps/mobile/package.json').name });
    const { devDependencies } = readJson(tree, 'apps/mobile/package.json');
    assert.equal(devDependencies.tailwindcss, '^4.3.3');
    assert.equal(devDependencies['@tailwindcss/cli'], '^4.3.3');
    assert.equal(readJson(tree, 'package.json').devDependencies.tailwindcss, undefined);
  });

  it('builds the sheet before a typecheck and ignores it, in an app generated before either', async () => {
    const tree = await integrated();
    const project = readProjectConfiguration(tree, 'mobile');
    project.targets!.typecheck!.options.command = 'ngc -p tsconfig.json --noEmit';
    updateProjectConfiguration(tree, 'mobile', project);
    tree.write('apps/mobile/.gitignore', '# generated native folders\n/ios\n/android\n');
    await generate(tree, {});
    const { typecheck } = readProjectConfiguration(tree, 'mobile').targets ?? {};
    assert.equal(typecheck?.options.command, native.TYPECHECK);
    assert.equal(read(tree, 'apps/mobile/.gitignore').match(/^\.angular-native\/$/gm)?.length, 1);
  });

  it('changes nothing when run again', async () => {
    const tree = await integrated();
    await generate(tree, { library: 'ui' });
    const before = snapshot(tree);
    await generate(tree, { library: 'ui' });
    assert.deepEqual(snapshot(tree), before);
  });

  it('names the project when it is not an Angular Native app', async () => {
    const tree = await integrated();
    await assert.rejects(generate(tree, { project: 'ui' }), /ui is not an Angular Native app/);
    await assert.rejects(generate(tree, { project: 'nope' }), /no project called "nope"/);
  });
});

describe("Tailwind 4, with a library's classes", () => {
  it('gives the library a stylesheet naming its own sources, and imports it', async () => {
    // Tailwind scans the app's directory, and a class used only in a library elsewhere was left
    // out of the sheet without a warning.
    const tree = await integrated();
    await generate(tree, { library: 'ui' });
    assert.match(read(tree, 'packages/ui/theme.css'), /^@source '\.\/src';$/m);
    assert.match(read(tree, 'packages/ui/theme.css'), /^@theme \{/m);
    assert.match(
      read(tree, 'apps/mobile/src/styles.css'),
      /^@import '\.\.\/\.\.\/\.\.\/packages\/ui\/theme\.css';$/m,
    );
  });

  it("keeps a library's own stylesheet, and adds a library on a later run", async () => {
    const tree = await integrated();
    tree.write('packages/ui/theme.css', "@source './src';\n@theme { --color-brand: red; }\n");
    await generate(tree, { library: 'ui' });
    await generate(tree, { library: 'tokens' });
    assert.equal(
      read(tree, 'packages/ui/theme.css'),
      "@source './src';\n@theme { --color-brand: red; }\n",
    );
    const styles = read(tree, 'apps/mobile/src/styles.css');
    assert.match(styles, /packages\/ui\/theme\.css/);
    assert.match(styles, /packages\/tokens\/theme\.css/);
  });

  it('takes several libraries at once, and names one it cannot find', async () => {
    const tree = await integrated();
    await generate(tree, { library: 'ui, tokens' });
    assert.ok(tree.exists('packages/tokens/theme.css'));
    await assert.rejects(generate(tree, { library: 'nope' }), /no project called "nope"/);
  });
});

describe('Tailwind 3', () => {
  it('writes the directives and a config that uses the preset', async () => {
    const tree = await integrated();
    await generate(tree, { tailwindVersion: 3 });
    assert.match(
      read(tree, 'apps/mobile/src/styles.css'),
      /@tailwind base;\n@tailwind components;\n@tailwind utilities;/,
    );
    const config = read(tree, 'apps/mobile/tailwind.config.js');
    assert.match(config, /presets: \[require\('@ng-native\/tailwind\/preset\.cjs'\)\]/);
    assert.match(config, /content: \['\.\/src\/\*\*\/\*\.\{ts,html\}'\]/);
    const { devDependencies } = readJson(tree, 'package.json');
    assert.equal(devDependencies.tailwindcss, '^3.4.1');
    assert.equal(devDependencies['@tailwindcss/cli'], undefined, 'Tailwind 3 ships its own CLI');
  });

  it("puts a library's preset first, spreads its content in, and allows its require", async () => {
    const tree = await integrated();
    tree.write(
      'eslint.config.mjs',
      "export default [{ rules: { '@nx/enforce-module-boundaries': ['error', { allow: ['^.*/eslint(\\\\.base)?\\\\.config\\\\.[cm]?[jt]s$'] }] } }];\n",
    );
    await generate(tree, { tailwindVersion: 3, library: 'ui' });
    assert.match(
      read(tree, 'packages/ui/tailwind.preset.cjs'),
      /content: \[join\(__dirname, 'src\/\*\*\/\*\.\{ts,html\}'\)\]/,
    );
    const config = read(tree, 'apps/mobile/tailwind.config.js');
    assert.match(config, /require\('\.\.\/\.\.\/packages\/ui\/tailwind\.preset\.cjs'\)/);
    assert.match(
      config,
      /presets: \[ui, \{ \.\.\.require\('@ng-native\/tailwind\/preset\.cjs'\), presets: \[\] \}\]/,
    );
    assert.match(config, /\.\.\.ui\.content/);
    assert.match(read(tree, 'eslint.config.mjs'), /'\^\.\*\/tailwind\\\\\.preset\\\\\.cjs\$'/);
  });

  it('adds a library on a later run, keeping the ones it has', async () => {
    const tree = await integrated();
    await generate(tree, { tailwindVersion: 3, library: 'ui' });
    await generate(tree, { tailwindVersion: 3, library: 'tokens' });
    const config = read(tree, 'apps/mobile/tailwind.config.js');
    assert.match(config, /packages\/ui\/tailwind\.preset\.cjs/);
    assert.match(config, /packages\/tokens\/tailwind\.preset\.cjs/);
    // Only the first preset brings Tailwind's defaults: a later one's would override its theme.
    assert.match(
      config,
      /presets: \[ui, \{ \.\.\.tokens, presets: \[\] \}, \{ \.\.\.require\('@ng-native\/tailwind\/preset\.cjs'\), presets: \[\] \}\]/,
    );
  });

  it('names two libraries with the same directory name apart', async () => {
    const tree = await integrated();
    library(tree, 'web-ui', 'packages/web/ui');
    await generate(tree, { tailwindVersion: 3, library: 'ui,web-ui' });
    const config = read(tree, 'apps/mobile/tailwind.config.js');
    assert.match(
      config,
      /^const ui = require\('\.\.\/\.\.\/packages\/ui\/tailwind\.preset\.cjs'\);$/m,
    );
    assert.match(
      config,
      /^const ui2 = require\('\.\.\/\.\.\/packages\/web\/ui\/tailwind\.preset\.cjs'\);$/m,
    );
  });

  it('follows the Tailwind the workspace has, and refuses the other', async () => {
    const tree = await integrated();
    updateJson(tree, 'package.json', (manifest) => {
      manifest.devDependencies.tailwindcss = '~3.4.17';
      return manifest;
    });
    await generate(tree, {});
    assert.ok(tree.exists('apps/mobile/tailwind.config.js'));
    assert.equal(readJson(tree, 'package.json').devDependencies.tailwindcss, '~3.4.17');
    await assert.rejects(generate(tree, { tailwindVersion: 4 }), /Tailwind 3 \(~3\.4\.17\)/);
  });
});

const V4_WEB_IMPORTS = [
  "@import 'tailwindcss/theme.css';",
  "@import 'tailwindcss/utilities.css';",
  "@import '@ng-native/tailwind/web.css';",
];

describe('Tailwind 4, in an app that also builds for a browser', () => {
  // The web build needs web.css, not native.css: `hover:`, `focus-visible:`, the safe area and
  // the hairline mean something else in a browser.
  it('gives the web build a stylesheet of its own, with the web preset', async () => {
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    await generate(tree, {});
    assert.equal(
      read(tree, 'apps/mobile/src/styles.web.css').trim().split('\n').slice(-3).join('\n'),
      V4_WEB_IMPORTS.join('\n'),
    );
    assert.match(read(tree, 'apps/mobile/src/styles.css'), /native\.css/);
    assert.doesNotMatch(read(tree, 'apps/mobile/src/styles.css'), /web\.css/);
  });

  it("adds Tailwind's Vite plugin after ngNativeWeb(), and the package", async () => {
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    await generate(tree, {});
    const config = read(tree, 'apps/mobile/vite.config.ts');
    assert.match(config, /^import tailwindcss from '@tailwindcss\/vite';$/m);
    assert.match(config, /plugins: \[ngNativeWeb\(\), tailwindcss\(\)\]/);
    assert.equal(readJson(tree, 'package.json').devDependencies['@tailwindcss/vite'], '^4.3.3');
  });

  it("links the stylesheet from index.html, out of TypeScript's way", async () => {
    // An import from the entry fails the app's typecheck on TypeScript 6 (TS2882), since a
    // native app's types declare no .css modules.
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    const entry = read(tree, 'apps/mobile/src/main.web.ts');
    await generate(tree, {});
    assert.match(
      read(tree, 'apps/mobile/index.html'),
      /^ {4}<link rel="stylesheet" href="\/src\/styles\.web\.css" \/>\n {2}<\/head>$/m,
    );
    assert.equal(read(tree, 'apps/mobile/src/main.web.ts'), entry);
    assert.doesNotMatch(read(tree, 'apps/mobile/src/main.ts'), /styles/);
  });

  it('leaves a stylesheet the entry imports already', async () => {
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    tree.write(
      'apps/mobile/src/main.web.ts',
      `import "./styles.web.css";\n${read(tree, 'apps/mobile/src/main.web.ts')}`,
    );
    await generate(tree, {});
    assert.doesNotMatch(read(tree, 'apps/mobile/index.html'), /stylesheet/);
  });

  it("imports a library's theme in both stylesheets, and changes nothing when run again", async () => {
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    await generate(tree, { library: 'ui' });
    await generate(tree, { library: 'tokens' });
    for (const file of ['src/styles.css', 'src/styles.web.css']) {
      const styles = read(tree, `apps/mobile/${file}`);
      assert.match(styles, /^@import '\.\.\/\.\.\/\.\.\/packages\/ui\/theme\.css';$/m, file);
      assert.match(styles, /^@import '\.\.\/\.\.\/\.\.\/packages\/tokens\/theme\.css';$/m, file);
    }
    const before = snapshot(tree);
    await generate(tree, { library: 'ui,tokens' });
    assert.deepEqual(snapshot(tree), before);
  });

  it('writes no web setup for an app without a Vite config using ngNativeWeb()', async () => {
    const tree = await integrated();
    tree.write('apps/mobile/vite.config.ts', 'export default { plugins: [] };\n');
    await generate(tree, {});
    assert.ok(!tree.exists('apps/mobile/src/styles.web.css'));
    assert.equal(readJson(tree, 'package.json').devDependencies['@tailwindcss/vite'], undefined);
  });
});

describe('Tailwind 4, in a browser app of its own', () => {
  it('sets up the web build only', async () => {
    const tree = await integrated();
    const root = webApp(tree);
    await generate(tree, { project: 'site', library: 'ui' });
    const styles = read(tree, `${root}/src/styles.css`);
    assert.match(styles, new RegExp(V4_WEB_IMPORTS.join('\n').replace(/[.*/()]/g, '\\$&')));
    assert.match(styles, /^@import '\.\.\/\.\.\/\.\.\/packages\/ui\/theme\.css';$/m);
    assert.match(read(tree, `${root}/vite.config.ts`), /ngNativeWeb\(\), tailwindcss\(\)/);
    assert.match(
      read(tree, `${root}/index.html`),
      /<link rel="stylesheet" href="\/src\/styles\.css" \/>/,
    );
    assert.ok(!tree.exists(`${root}/metro.config.js`));
    const { devDependencies } = readJson(tree, 'package.json');
    assert.equal(devDependencies['@tailwindcss/vite'], '^4.3.3');
    assert.equal(devDependencies['@tailwindcss/cli'], undefined, 'only Metro runs the CLI');
  });

  it('puts the imports ahead of a stylesheet the app has already', async () => {
    const tree = await integrated();
    const root = webApp(tree);
    tree.write(`${root}/src/styles.css`, 'body {\n  margin: 0;\n}\n');
    await generate(tree, { project: 'site' });
    assert.equal(
      read(tree, `${root}/src/styles.css`),
      `${V4_WEB_IMPORTS.join('\n')}\n\nbody {\n  margin: 0;\n}\n`,
    );
    const before = snapshot(tree);
    await generate(tree, { project: 'site' });
    assert.deepEqual(snapshot(tree), before);
  });
});

describe('Tailwind 3, in an app that also builds for a browser', () => {
  it("writes a web config from the app's, with the web preset, and a PostCSS config", async () => {
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    await generate(tree, { tailwindVersion: 3 });
    const config = read(tree, 'apps/mobile/tailwind.web.config.js');
    assert.match(config, /\.\.\.require\('\.\/tailwind\.config\.js'\)/);
    assert.match(config, /presets: \[require\('@ng-native\/tailwind\/web-preset\.cjs'\)\]/);
    assert.doesNotMatch(config, /preset\.cjs'\)\s*[,\]].*preset\.cjs/);
    assert.match(
      read(tree, 'apps/mobile/postcss.config.js'),
      /plugins: \{ tailwindcss: \{ config: '\.\/tailwind\.web\.config\.js' \} \}/,
    );
    // Vite runs Tailwind 3 through PostCSS, so its config needs nothing more.
    assert.doesNotMatch(read(tree, 'apps/mobile/vite.config.ts'), /tailwindcss/);
    assert.match(
      read(tree, 'apps/mobile/index.html'),
      /<link rel="stylesheet" href="\/src\/styles\.css" \/>/,
    );
  });

  it("lists each library's preset ahead of the web preset, and changes nothing when run again", async () => {
    const tree = await integrated();
    web(tree, 'apps/mobile', 'src/main.web.ts');
    await generate(tree, { tailwindVersion: 3, library: 'ui' });
    await generate(tree, { tailwindVersion: 3, library: 'tokens' });
    const config = read(tree, 'apps/mobile/tailwind.web.config.js');
    assert.match(
      config,
      /presets: \[ui, \{ \.\.\.tokens, presets: \[\] \}, \{ \.\.\.require\('@ng-native\/tailwind\/web-preset\.cjs'\), presets: \[\] \}\]/,
    );
    assert.doesNotMatch(config, /tailwind\/preset\.cjs/);
    const before = snapshot(tree);
    await generate(tree, { tailwindVersion: 3, library: 'ui,tokens' });
    assert.deepEqual(snapshot(tree), before);
  });
});

describe('Tailwind 3, in a browser app of its own', () => {
  it('writes a config with the web preset, the directives and a PostCSS config', async () => {
    const tree = await integrated();
    const root = webApp(tree);
    await generate(tree, { project: 'site', tailwindVersion: 3 });
    const config = read(tree, `${root}/tailwind.config.js`);
    assert.match(config, /presets: \[require\('@ng-native\/tailwind\/web-preset\.cjs'\)\]/);
    assert.match(config, /content: \['\.\/src\/\*\*\/\*\.\{ts,html\}'\]/);
    assert.match(read(tree, `${root}/src/styles.css`), /@tailwind utilities;/);
    assert.match(
      read(tree, `${root}/postcss.config.js`),
      /tailwindcss: \{ config: '\.\/tailwind\.config\.js' \}/,
    );
    assert.match(
      read(tree, `${root}/index.html`),
      /<link rel="stylesheet" href="\/src\/styles\.css" \/>/,
    );
    assert.ok(!tree.exists(`${root}/tailwind.web.config.js`));
  });

  it('writes them as .cjs in an ES module package, where module.exports would throw', async () => {
    // The web page's own setup starts with npm pkg set type=module.
    const tree = await integrated();
    const root = webApp(tree);
    tree.write(`${root}/package.json`, '{ "name": "site", "type": "module" }\n');
    await generate(tree, { project: 'site', tailwindVersion: 3 });
    assert.ok(tree.exists(`${root}/tailwind.config.cjs`));
    assert.match(read(tree, `${root}/postcss.config.cjs`), /config: '\.\/tailwind\.config\.cjs'/);
    assert.ok(!tree.exists(`${root}/tailwind.config.js`));
    assert.ok(!tree.exists(`${root}/postcss.config.js`));
  });
});

describe('a web build whose files it cannot follow', () => {
  it('says what to add by hand rather than guessing', async () => {
    const tree = await integrated();
    const root = webApp(tree);
    tree.write(`${root}/vite.config.ts`, 'export default makeConfig({ ngNativeWeb: true });\n');
    tree.write(`${root}/index.html`, '<!doctype html>\n<html></html>\n');
    tree.write(`${root}/postcss.config.js`, 'module.exports = { plugins: {} };\n');
    const v4 = await warningsOf(() => generate(tree, { project: 'site' }));
    assert.equal(
      read(tree, `${root}/vite.config.ts`),
      'export default makeConfig({ ngNativeWeb: true });\n',
    );
    assert.ok(
      v4.some((message) => /tailwindcss\(\)/.test(message)),
      v4.join('\n'),
    );
    assert.ok(
      v4.some((message) => /index\.html/.test(message) && /styles\.css/.test(message)),
      v4.join('\n'),
    );

    const tree3 = await integrated();
    webApp(tree3);
    tree3.write(`${root}/postcss.config.js`, 'module.exports = { plugins: {} };\n');
    const v3 = await warningsOf(() => generate(tree3, { project: 'site', tailwindVersion: 3 }));
    assert.equal(read(tree3, `${root}/postcss.config.js`), 'module.exports = { plugins: {} };\n');
    assert.ok(
      v3.some((message) => /postcss\.config\.js/.test(message)),
      v3.join('\n'),
    );
  });
});

describe('its options', () => {
  it('take the Tailwind major as --tailwindVersion, since nx g reads --version as its own', () => {
    // `nx g @ng-native/nx:tailwind mobile --version=3` reached the generator as version: false.
    const { properties } = require('./schema.json') as { properties: Record<string, unknown> };
    assert.ok('tailwindVersion' in properties);
    assert.ok(!('version' in properties));
  });
});

describe('an app whose files it cannot follow', () => {
  it('says what to add by hand rather than guessing', async () => {
    const tree = await integrated();
    tree.write('apps/mobile/metro.config.js', 'module.exports = makeConfig(\n  __dirname,\n);\n');
    const warnings: string[] = [];
    const { logger } = require('@nx/devkit') as typeof import('@nx/devkit');
    const warn = logger.warn;
    logger.warn = (message: unknown) => void warnings.push(String(message));
    try {
      await generate(tree, {});
    } finally {
      logger.warn = warn;
    }
    assert.equal(
      read(tree, 'apps/mobile/metro.config.js'),
      'module.exports = makeConfig(\n  __dirname,\n);\n',
    );
    assert.ok(
      warnings.some((message) => /withTailwind/.test(message)),
      warnings.join('\n'),
    );
  });

  it('warns about a typecheck of its own that does not build the sheet first', async () => {
    // A fresh checkout has no sheet until Metro's config is loaded, and ngc fails on the import.
    const tree = await integrated();
    const project = readProjectConfiguration(tree, 'mobile');
    const custom = 'ngc -p tsconfig.json --noEmit --extendedDiagnostics';
    project.targets!.typecheck!.options.command = custom;
    updateProjectConfiguration(tree, 'mobile', project);
    const warnings: string[] = [];
    const { logger } = require('@nx/devkit') as typeof import('@nx/devkit');
    const warn = logger.warn;
    logger.warn = (message: unknown) => void warnings.push(String(message));
    try {
      await generate(tree, {});
    } finally {
      logger.warn = warn;
    }
    const { typecheck } = readProjectConfiguration(tree, 'mobile').targets ?? {};
    assert.equal(typecheck?.options.command, custom, 'left as it is');
    assert.ok(
      warnings.some(
        (message) => /typecheck/.test(message) && /node metro\.config\.js/.test(message),
      ),
      warnings.join('\n'),
    );
  });
});
