/**
 * Publish everything to a local registry, generate an app from the template, test it and bundle it.
 *
 * The thing this checks that nothing else does is *distribution*: that the packages publish at
 * all, that they find each other by version through a registry rather than through workspace
 * links, and that `create-expo-app --template` produces something that builds and whose tests
 * run. A tarball installed by path proves none of that - it resolves siblings by file path, which
 * is exactly the part a real install does differently.
 *
 * Nothing reaches npmjs. Verdaccio serves `@ng-native/*` itself and proxies the rest, and
 * the registry is configured with no uplink for our scope so a package that failed to publish
 * cannot be quietly satisfied by the real registry.
 *
 * `--generators` also adds a native app to a fresh `ng new` workspace with `ng add
 * @ng-native/schematics`, and to a fresh Nx `angular-monorepo` workspace with `nx add
 * @ng-native/nx`, and tests and bundles each. Both install with npm, which refuses a peer range it
 * cannot satisfy where pnpm only warns. They take minutes, so the release workflow runs them and
 * CI does not. `--generators=angular` or `--generators=nx` runs one of the two and skips the
 * template, which is how the release workflow runs them side by side.
 *
 * `--scenario=<name>` runs one of `SCENARIOS` below instead, for the weekly workflow in
 * `latest.yml`: a workspace made the way a user makes one, on the newest versions its ranges
 * allow, then installed a second time, tested, and exported for both platforms. It ends by
 * printing the Angular, Expo, React Native, Nx, Vitest, TypeScript and Vite it resolved, into the
 * job summary on GitHub Actions, so a failure names the release that caused it.
 *
 * `--web` also sets up a browser app on `@ng-native/web` the way its documentation page does, from
 * the registry, builds it with Vite and checks it renders and responds in Chromium. The `web`
 * scenario runs that alone.
 *
 * `--storybook` runs only the Storybook recipe from the web docs' `storybook.md` page: that browser
 * app with Storybook added, on the Storybook and Vite versions the page states, built with
 * `storybook build` and checked in Chromium. The release workflow runs it.
 *
 * Usage: node scripts/verify-publish.mjs [--generators[=angular|nx]] [--web] | --scenario=<name> | --storybook
 *        (with verdaccio listening on 4873, or on $REGISTRY)
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = process.env.REGISTRY ?? 'http://localhost:4873';

/** Every package that would go to npm, plus the template. */
const PUBLISHED = [
  'packages/analog',
  'packages/components',
  'packages/device',
  'packages/expo',
  'packages/fabric',
  'packages/icons',
  'packages/metro',
  'packages/migrate',
  'packages/nx',
  'packages/platform',
  'packages/router',
  'packages/schematics',
  'packages/tailwind',
  'packages/testing',
  'packages/web',
  'template',
];

/**
 * Fresh caches for every run: npm's, pnpm's metadata, and `create-expo-app`'s template cache,
 * which lives under the temp directory.
 *
 * Every build publishes the same `0.0.0`, so a cache keyed by name and version hands back whatever
 * the *last* run published. `create-expo-app` did exactly that: the app it generated was from a
 * template several changes old, and the check passed or failed on code nobody had written this
 * time. pnpm's content-addressed store is safe to share, because fresh metadata brings a fresh
 * integrity hash with it.
 */
const caches = mkdtempSync(path.join(tmpdir(), 'angular-native-caches-'));

const run = (cmd, args, cwd, quiet = true) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: {
      ...process.env,
      npm_config_registry: REGISTRY,
      // pnpm 11 reads its own prefix, not npm's.
      pnpm_config_registry: REGISTRY,
      npm_config_cache: path.join(caches, 'npm'),
      // pnpm's metadata cache, for the installs `create-nx-workspace` and `nx add` start, which
      // pass no `--cache-dir`. Not `npm_config_cache_dir`, which npm warns about on every command.
      XDG_CACHE_HOME: path.join(caches, 'xdg'),
      TMPDIR: caches,
      // Off, as it is on CI already: a daemon outlives the workspace it was started in.
      NX_DAEMON: 'false',
    },
  });

/** `npm install` or `pnpm install`, from the registry, with this run's fresh caches. */
const install = (pm, cwd) =>
  pm === 'pnpm'
    ? run('pnpm', ['install', '--cache-dir', path.join(caches, 'pnpm')], cwd)
    : run('npm', ['install'], cwd);

const manifestOf = (dir) => path.join(root, dir, 'package.json');

function publishAll() {
  for (const dir of PUBLISHED) {
    const { name, version } = JSON.parse(readFileSync(manifestOf(dir), 'utf8'));
    // Every run publishes the same version, so an earlier run's is removed first: skipping it would
    // check that run's build instead of this one. Nothing to remove is fine.
    try {
      run('npm', ['unpublish', `${name}@${version}`, '--force', '--registry', REGISTRY], root);
    } catch {}
    try {
      // `--no-git-checks`: this runs against a working tree, committed or not.
      run(
        'pnpm',
        ['publish', '--registry', REGISTRY, '--no-git-checks', '--tag', 'local'],
        path.join(root, dir),
      );
      console.log(`  published  ${name}`);
    } catch (error) {
      throw new Error(`${name}: ${String(error.stdout ?? '')}${String(error.stderr ?? '')}`);
    }
  }
}

function generateApp(dir = mkdtempSync(path.join(tmpdir(), 'angular-native-probe-'))) {
  const app = path.join(dir, 'app');
  console.log(`\ngenerating an app in ${app}`);
  run(
    'npx',
    [
      '--yes',
      'create-expo-app@latest',
      app,
      '--template',
      '@ng-native/template',
      '--no-install',
      '--no-agents-md',
    ],
    dir,
  );
  return app;
}

/**
 * Installs, typechecks, tests and bundles an app from the template. `latest` is a scenario's
 * wider check: the install run a second time, as a user's next `npm install` would, and an Android
 * bundle beside the iOS one.
 */
function check(app, { pm = 'pnpm', latest = false } = {}) {
  // The generated app resolves @ng-native/* from the registry, by version, like a stranger.
  writeFileSync(path.join(app, '.npmrc'), `registry=${REGISTRY}\n`);
  console.log(`installing from the registry with ${pm}`);
  install(pm, app);
  if (latest) {
    console.log(`${pm} install, again`);
    install(pm, app);
  }

  console.log('typechecking');
  run('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], app);

  // The template's own example test, through `@ng-native/testing` as installed: the proof that
  // the Vitest plugin compiles `@ng-native/*` source out of `node_modules` and links Angular's
  // partial-compiled packages there, which inside this workspace are symlinked source instead.
  console.log('testing');
  run(pm, ['test'], app);

  console.log('bundling');
  const modules = bundle(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--output-dir', path.join(app, 'dist')],
    app,
  );
  if (latest) {
    console.log('bundling for android');
    bundle(
      'npx',
      ['expo', 'export', '--platform', 'android', '--output-dir', path.join(app, 'dist-android')],
      app,
    );
  }

  // The dev bundle too: it carries the HMR blocks a release bundle leaves out, and those broke on
  // `node_modules/@ng-native/...` paths while the release bundle above still built.
  console.log('bundling for development');
  run(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--dev', '--output-dir', path.join(app, 'dist-dev')],
    app,
  );
  return modules;
}

/** The iOS bundle of an app, and its module count, or a failure with Metro's output. */
function bundle(cmd, args, cwd) {
  // Nx passes the child's colours through, which split the line this reads.
  const out = run(cmd, args, cwd).replace(/\x1b\[[0-9;]*m/g, '');
  const modules = /Bundled \d+ms .*? \((\d+) modules\)/.exec(out)?.[1];
  if (!modules) throw new Error(`no bundle was produced:\n${out}`);
  return modules;
}

/**
 * Starts a dev server the way a person would, and has it build the app: Metro up, the iOS manifest
 * Expo Go would ask for, then the bundle that manifest names. Stopped either way.
 */
async function serve(cmd, args, cwd, port) {
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_registry: REGISTRY, pnpm_config_registry: REGISTRY, CI: '1' },
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const base = `http://localhost:${port}`;
  try {
    for (let tries = 0; ; tries++) {
      const status = await fetch(`${base}/status`).then(
        (r) => r.text(),
        () => '',
      );
      if (status.includes('packager-status:running')) break;
      if (tries === 180 || child.exitCode !== null) throw new Error(`no dev server:\n${log}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const manifest = await fetch(base, { headers: { 'expo-platform': 'ios' } }).then((r) =>
      r.json(),
    );
    const bundle = await fetch(manifest.launchAsset.url);
    const code = await bundle.text();
    if (!bundle.ok || code.length < 100_000) {
      throw new Error(
        `the dev server did not build the app (${bundle.status}):\n${code.slice(0, 2000)}`,
      );
    }
    return `${Math.round(code.length / 1024)} KB`;
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone: Metro can exit on its own before the server ever answers.
    }
  }
}

/**
 * A workspace `ng new` made, with the native app `ng add` puts beside its web one. `latest` also
 * installs a second time after `ng add`, and builds for Android and for every platform at once.
 */
async function angularWorkspace(dir, { latest = false } = {}) {
  console.log('\nng new, then ng add @ng-native/schematics');
  // Not quiet: these installs are minutes, and the log should show them moving.
  run('npx', ['--yes', '@angular/cli@22', 'new', 'web', '--defaults', '--skip-git'], dir, false);
  const workspace = path.join(dir, 'web');
  writeFileSync(path.join(workspace, '.npmrc'), `registry=${REGISTRY}\n`);
  run('npx', ['ng', 'add', '@ng-native/schematics@local', '--skip-confirmation'], workspace, false);
  if (latest) {
    console.log('npm install, again');
    install('npm', workspace);
  }
  console.log('testing the web app and the native one');
  run('npx', ['ng', 'test', '--watch=false'], workspace);
  console.log('ng build native');
  const modules = bundle('npx', ['ng', 'build', 'native', '--platform', 'ios'], workspace);
  if (latest) {
    console.log('ng build native --platform android');
    bundle('npx', ['ng', 'build', 'native', '--platform', 'android'], workspace);
    console.log('ng build native, for every platform');
    bundle('npx', ['ng', 'build', 'native'], workspace);
  }
  console.log('ng serve native');
  const served = await serve('npx', ['ng', 'serve', 'native', '--port', '8091'], workspace, 8091);
  return `${modules} modules, and ng serve builds ${served}`;
}

/**
 * The Nx presets a scenario starts from, each with the library generator its users reach for.
 * The TypeScript preset cannot have `@nx/angular`, which does not support project references, so
 * its library is `@nx/js`'s, whose index imports `./lib/ui.js` for a `ui.ts`.
 */
const NX_PRESETS = {
  'angular-monorepo': {
    args: ['--preset=angular-monorepo', '--appName=web'],
    library: ['@nx/angular:library', 'libs/ui'],
    extension: '',
  },
  ts: { args: ['--preset=ts'], library: ['@nx/js:library', 'packages/ui'], extension: '.js' },
};

/**
 * A workspace from one of Nx's presets, with an app from `@ng-native/nx`. `latest` also generates
 * a library the app imports, installs a second time, and runs the rest of the targets a user
 * would: an Android export, a bare one for every platform, and `nx prebuild`.
 */
async function nxWorkspace(
  dir,
  { preset = 'angular-monorepo', pm = 'npm', latest = false, port = 8092 } = {},
) {
  console.log(`\ncreate-nx-workspace --preset=${preset} with ${pm}, then nx add @ng-native/nx`);
  run(
    'npx',
    [
      '--yes',
      'create-nx-workspace@latest',
      'monorepo',
      ...NX_PRESETS[preset].args,
      `--packageManager=${pm}`,
      // No `--ci=skip`: create-nx-workspace 23.2.1 passes it on twice and then fails on
      // `'skip,skip'`. Without it, a non-interactive run generates no CI workflow anyway.
      '--nxCloud=skip',
      '--interactive=false',
    ],
    dir,
    // Not quiet: this and the two below are installs of minutes, and the log should show them.
    false,
  );
  const workspace = path.join(dir, 'monorepo');
  writeFileSync(path.join(workspace, '.npmrc'), `registry=${REGISTRY}\n`);
  run('npx', ['nx', 'add', '@ng-native/nx@local'], workspace, false);
  run('npx', ['nx', 'g', '@ng-native/nx:app', 'apps/mobile', '--no-interactive'], workspace, false);
  // `mobile`, or `@monorepo/mobile` where the root package is scoped, as the TypeScript preset's is.
  const project = readJson(path.join(workspace, 'apps/mobile/package.json')).name;
  if (latest) {
    addLibrary(workspace, preset, pm);
    console.log(`${pm} install, again`);
    install(pm, workspace);
  }
  console.log('typechecking and testing');
  run('npx', ['nx', 'run-many', '-t', 'typecheck', 'test', '-p', project], workspace);
  console.log(`nx export ${project}`);
  const modules = bundle('npx', ['nx', 'export', project, '--platform', 'ios'], workspace);
  if (latest) {
    console.log(`nx export ${project} --platform android`);
    bundle('npx', ['nx', 'export', project, '--platform', 'android'], workspace);
    console.log(`nx export ${project}, for every platform`);
    bundle('npx', ['nx', 'export', project], workspace);
  }
  console.log(`nx start ${project}`);
  const served = await serve(
    'npx',
    ['nx', 'start', project, '--port', String(port)],
    workspace,
    port,
  );
  if (latest) {
    // Last, because it writes the native projects into the app. `--no-install` leaves CocoaPods
    // out of it, which only a Mac has.
    console.log(`nx prebuild ${project}`);
    run('npx', ['nx', 'prebuild', project, '--no-install'], workspace);
  }
  return `${modules} modules, and nx start builds ${served}`;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

/** A component in a workspace library, drawn with the framework's own elements. */
const GREETING = `import { Component, input } from '@angular/core';
import { Text, View } from '@ng-native/components';

@Component({
  selector: 'lib-greeting',
  imports: [Text, View],
  template: '<view><text>Hello from {{ from() }}</text></view>',
})
export class Greeting {
  readonly from = input.required<string>();
}
`;

const LIBRARY_TEST = `
test('shows the library component', async () => {
  await render(App);

  expect(screen.getByText('Hello from the library')).toBeTruthy();
});
`;

/** Replaces `from` with `to` in `file`, or fails naming the file that no longer has `from`. */
function replaceIn(file, from, to) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${file} no longer has ${JSON.stringify(from)}`);
  writeFileSync(file, text.replace(from, to));
}

/**
 * Generates `@monorepo/ui` with the preset's library generator, adds a component to it, and has the
 * app render it and test it: Metro and Vitest then have to compile a library's Angular source
 * ahead of time, from outside the app, through whatever resolution the preset set up.
 */
function addLibrary(workspace, preset, pm) {
  const {
    library: [generator, directory],
    extension,
  } = NX_PRESETS[preset];
  console.log(`nx g ${generator} ${directory}, imported by the app`);
  run(
    'npx',
    ['nx', 'g', generator, directory, '--importPath=@monorepo/ui', '--no-interactive'],
    workspace,
  );
  const library = path.join(workspace, directory);
  writeFileSync(path.join(library, 'src/lib/greeting.ts'), GREETING);
  appendFileSync(
    path.join(library, 'src/index.ts'),
    `export * from './lib/greeting${extension}';\n`,
  );

  const app = path.join(workspace, 'apps/mobile');
  const source = path.join(app, 'src/app/app.ts');
  replaceIn(
    source,
    "from '@ng-native/components';",
    "from '@ng-native/components';\nimport { Greeting } from '@monorepo/ui';",
  );
  replaceIn(source, 'imports: [Pressable,', 'imports: [Greeting, Pressable,');
  // Not `<pressable ` with its attributes: the generator's Prettier breaks them onto lines.
  replaceIn(source, '<pressable', '<lib-greeting from="the library" />\n\n        <pressable');
  appendFileSync(path.join(app, 'src/app/app.test.ts'), LIBRARY_TEST);

  // A library that is a workspace package is a dependency like any other: the app names it, and
  // it names what it imports, so a strict package manager links both.
  const manifest = path.join(library, 'package.json');
  if (!existsSync(manifest)) return;
  const appManifest = readJson(path.join(app, 'package.json'));
  appManifest.dependencies['@monorepo/ui'] = pm === 'pnpm' ? 'workspace:*' : '*';
  writeJson(path.join(app, 'package.json'), appManifest);
  const libraryManifest = readJson(manifest);
  libraryManifest.dependencies = {
    ...libraryManifest.dependencies,
    '@angular/core': appManifest.dependencies['@angular/core'],
    '@ng-native/components': appManifest.dependencies['@ng-native/components'],
  };
  writeJson(manifest, libraryManifest);
}

/**
 * The browser app `apps/documentation/src/content/packages/web.md` sets up, file for file: a Vite
 * config with `ngNativeWeb()`, Tailwind with the web preset, and one component with a text, a
 * pressable that counts, and a view styled by its own CSS.
 */
const WEB_FILES = {
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  'vite.config.ts': `import tailwindcss from '@tailwindcss/vite';
import { ngNativeWeb } from '@ng-native/web/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [ngNativeWeb(), tailwindcss()],
});
`,
  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
`,
  'src/styles.css': `@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
@import '@ng-native/tailwind/web.css';
`,
  'src/main.ts': `import { mount } from '@ng-native/web';
import { App } from './app.ts';
import './styles.css';

mount(document.getElementById('root')!, App);
`,
  'src/app.ts': `import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Pressable, Text, View],
  styles: \`
    .card {
      margin: 24px;
      padding: 16px;
      gap: 12px;
      border-radius: 12px;
      background-color: rgb(238, 242, 255);
    }
  \`,
  template: \`
    <view class="card" testID="card">
      <text class="text-lg font-semibold">Hello from Angular Native</text>
      <pressable
        class="rounded-lg bg-blue-600 px-4 py-2"
        testID="counter"
        accessibilityRole="button"
        (press)="increment()"
      >
        <text class="text-white">Pressed {{ count() }} times</text>
      </pressable>
    </view>
  \`,
})
export class App {
  protected readonly count = signal(0);

  protected increment(): void {
    this.count.update((count) => count + 1);
  }
}
`,
};

/** The install commands `web.md` gives, in order. */
const WEB_INSTALLS = [
  ['install', '@angular/core', 'rxjs', '@ng-native/components', '@ng-native/web'],
  ['install', '--save-dev', 'vite', 'typescript'],
  ['install', '--save-dev', 'tailwindcss', '@tailwindcss/vite', '@ng-native/tailwind'],
];

/**
 * A browser app from the packages on the registry: installed the way `web.md` says, typechecked,
 * built with Vite, served with `vite preview` and driven in Chromium. The text renders, a press
 * updates the count, and the view's own CSS and a Tailwind class both reach the page.
 *
 * Chromium comes from `@ng-native/web`'s own Playwright in this workspace, so the app installs
 * nothing a user would not.
 */
async function webApp(dir) {
  const app = path.join(dir, 'web');
  console.log(`\nsetting up a browser app in ${app}`);
  mkdirSync(path.join(app, 'src'), { recursive: true });
  writeFileSync(path.join(app, '.npmrc'), `registry=${REGISTRY}\n`);
  run('npm', ['init', '-y'], app);
  run('npm', ['pkg', 'set', 'type=module'], app);
  for (const args of WEB_INSTALLS) run('npm', args, app);
  for (const [file, text] of Object.entries(WEB_FILES)) writeFileSync(path.join(app, file), text);

  console.log('typechecking');
  run('npx', ['tsc', '-p', 'tsconfig.json'], app);
  console.log('vite build');
  run('npx', ['vite', 'build'], app);
  console.log('vite preview, in Chromium');
  return preview(app, 4180);
}

/**
 * Serves the built app (`dist`, or `outDir`) and checks it in a real browser, stopping the server
 * either way.
 */
async function preview(app, port, { outDir = 'dist', checkPage = checkWebPage } = {}) {
  const child = spawn(
    process.execPath,
    [
      path.join(app, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--outDir',
      outDir,
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const url = `http://localhost:${port}/`;
  const { chromium } = createRequire(path.join(root, 'packages/web/package.json'))('playwright');
  const browser = await chromium.launch();
  const up = () =>
    fetch(url).then(
      (response) => response.ok,
      () => false,
    );
  try {
    for (let tries = 0; !(await up()); tries++) {
      if (tries === 60 || child.exitCode !== null) throw new Error(`no preview server:\n${log}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return await checkPage(await browser.newPage(), url);
  } finally {
    await browser.close();
    child.kill();
  }
}

/** What the page has to show, and what a press has to change. */
async function checkWebPage(page, url) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(url);
  const counter = page.getByTestId('counter');
  try {
    await page.getByText('Hello from Angular Native').waitFor({ timeout: 10_000 });
    await counter.getByText('Pressed 0 times').waitFor({ timeout: 1_000 });
  } catch {
    throw new Error(`the app did not render:\n${errors.join('\n') || (await page.content())}`);
  }
  await counter.click();
  await counter.click();
  await counter.getByText('Pressed 2 times').waitFor({ timeout: 2_000 });

  const styles = await page.evaluate(() => {
    const read = (id, property) =>
      getComputedStyle(document.querySelector(`[data-testid="${id}"]`))[property];
    return { card: read('card', 'backgroundColor'), counter: read('counter', 'backgroundColor') };
  });
  if (styles.card !== 'rgb(238, 242, 255)') {
    throw new Error(`the component's own CSS did not apply: ${styles.card}`);
  }
  // Tailwind 4's `bg-blue-600` is an oklch() colour; without the class there is no background.
  if (!styles.counter.startsWith('oklch(')) {
    throw new Error(`the Tailwind class did not apply: ${styles.counter}`);
  }
  if (errors.length) throw new Error(`the page logged errors:\n${errors.join('\n')}`);
  return 'with Vite and, in Chromium, renders, counts presses and applies its CSS and Tailwind';
}

const STORYBOOK_PAGE = path.join(root, 'apps/documentation/src/content/packages/web/storybook.md');

/**
 * The Storybook and Vite versions the recipe states it is checked on, so the check installs those
 * and a new Storybook release cannot fail a release of ours. Moving to a newer one is a change to
 * the page.
 */
function storybookVersions() {
  const page = readFileSync(STORYBOOK_PAGE, 'utf8');
  const stated = /checked on Storybook (\d+\.\d+\.\d+) and Vite (\d+\.\d+\.\d+)\./.exec(page);
  if (!stated) throw new Error(`${STORYBOOK_PAGE} states no Storybook and Vite versions`);
  const [, storybook, vite] = stated;
  if (!page.includes(`storybook@${storybook} @storybook/html-vite@${storybook}`)) {
    throw new Error(`${STORYBOOK_PAGE} installs a Storybook other than the ${storybook} it states`);
  }
  return { storybook, vite };
}

/** Every ```ts block on `storybook.md`, in page order. */
function storybookSamples() {
  const page = readFileSync(STORYBOOK_PAGE, 'utf8');
  return [...page.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((match) => match[1]);
}

/** The one block on `storybook.md` that `test` picks out, so the check builds what the page shows. */
function storybookSample(what, test) {
  const found = storybookSamples().filter(test);
  if (found.length !== 1) {
    throw new Error(`${STORYBOOK_PAGE} has ${found.length} blocks for ${what}, not 1`);
  }
  return found[0];
}

/**
 * The Storybook recipe, with Tailwind, read from `storybook.md` itself so the page and the check
 * cannot drift: its Tailwind `main.ts`, its `preview.ts` with the stylesheet import the Tailwind
 * section adds, and its Counter story. Only the component is the check's own, since the page does
 * not show one; it also says when it is destroyed, which is what the check counts.
 */
function storybookFiles() {
  return {
    '.storybook/main.ts': storybookSample('the Tailwind main.ts', (code) =>
      code.includes('tailwindcss()'),
    ),
    '.storybook/preview.ts':
      storybookSample(
        'the stylesheet import',
        (code) => code.trim() === "import '../src/styles.css';",
      ) + storybookSample('preview.ts', (code) => code.includes('const preview: Preview')),
    'src/counter.stories.ts': storybookSample('the Counter story', (code) =>
      code.includes("title: 'Counter'"),
    ),
    'src/counter.ts': `import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

@Component({
  selector: 'app-counter',
  imports: [Pressable, Text, View],
  styles: \`
    .card {
      margin: 24px;
      padding: 16px;
      gap: 12px;
      border-radius: 12px;
      background-color: rgb(238, 242, 255);
    }
  \`,
  template: \`
    <view class="card" testID="card">
      <text>{{ label() }}</text>
      <pressable
        class="rounded-lg bg-blue-600 px-4 py-2"
        testID="counter"
        accessibilityRole="button"
        (press)="increment()"
      >
        <text class="text-white">Pressed {{ count() }} times</text>
      </pressable>
    </view>
  \`,
})
export class Counter {
  readonly label = input('Counter');

  constructor() {
    // What the check counts: a story's app is torn down, not just taken off the page.
    inject(DestroyRef).onDestroy(() => console.info('counter destroyed'));
  }

  protected readonly count = signal(0);

  protected increment(): void {
    this.count.update((count) => count + 1);
  }
}
`,
  };
}

/**
 * The browser app `web.md` sets up, with Storybook added as `storybook.md` says: installed from the
 * registry, typechecked, built with `storybook build`, served and driven in Chromium.
 */
async function storybookApp(dir) {
  const { storybook, vite } = storybookVersions();
  const app = path.join(dir, 'storybook');
  console.log(`\nsetting up Storybook ${storybook} on Vite ${vite} in ${app}`);
  mkdirSync(path.join(app, '.storybook'), { recursive: true });
  mkdirSync(path.join(app, 'src'), { recursive: true });
  writeFileSync(path.join(app, '.npmrc'), `registry=${REGISTRY}\n`);
  run('npm', ['init', '-y'], app);
  run('npm', ['pkg', 'set', 'type=module'], app);
  run('npm', ['install', '@angular/core', 'rxjs', '@ng-native/components', '@ng-native/web'], app);
  run(
    'npm',
    [
      'install',
      '--save-dev',
      `vite@${vite}`,
      'typescript',
      'tailwindcss',
      '@tailwindcss/vite',
      '@ng-native/tailwind',
      `storybook@${storybook}`,
      `@storybook/html-vite@${storybook}`,
      `@storybook/addon-docs@${storybook}`,
    ],
    app,
  );
  const files = {
    ...storybookFiles(),
    // The browser app's own config, which Storybook's Vite builder loads beneath `viteFinal`.
    'vite.config.ts': WEB_FILES['vite.config.ts'],
    'tsconfig.json': WEB_FILES['tsconfig.json'].replace(
      '"include": ["src"]',
      '"include": ["src", ".storybook"]',
    ),
    'src/styles.css': WEB_FILES['src/styles.css'],
  };
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(app, file), text);

  console.log('typechecking');
  run('npx', ['tsc', '-p', 'tsconfig.json'], app);
  console.log('storybook build');
  run('npx', ['storybook', 'build', '--disable-telemetry'], app);
  console.log('serving storybook-static, in Chromium');
  return preview(app, 4181, { outDir: 'storybook-static', checkPage: checkStorybook });
}

/**
 * A story renders with its args as inputs, responds to a press, and has its component's CSS and
 * Tailwind; a control edit leaves one app with the new input; the docs page shows every story.
 */
async function checkStorybook(page, url) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let destroyed = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.text() === 'counter destroyed') destroyed++;
  });
  await page.goto(`${url}?path=/story/counter--labelled`);
  const story = page.frameLocator('#storybook-preview-iframe');
  const counter = story.getByTestId('counter');
  try {
    await story.getByText('Hello from Storybook').waitFor({ timeout: 15_000 });
  } catch {
    throw new Error(`the story did not render:\n${errors.join('\n') || (await page.content())}`);
  }
  await counter.click();
  await counter.click();
  await counter.getByText('Pressed 2 times').waitFor({ timeout: 2_000 });

  const styles = await story.locator('body').evaluate(() => {
    const read = (id, property) =>
      getComputedStyle(document.querySelector(`[data-testid="${id}"]`))[property];
    return { card: read('card', 'backgroundColor'), counter: read('counter', 'backgroundColor') };
  });
  if (styles.card !== 'rgb(238, 242, 255)') {
    throw new Error(`the component's own CSS did not apply: ${styles.card}`);
  }
  if (!styles.counter.startsWith('oklch(')) {
    throw new Error(`the Tailwind class did not apply: ${styles.counter}`);
  }

  await page.locator('textarea[name="label"], input[name="label"]').first().fill('Edited');
  await story.getByText('Edited', { exact: true }).waitFor({ timeout: 5_000 });
  const cards = await story.getByTestId('card').count();
  if (cards !== 1 || destroyed !== 1) {
    throw new Error(`after a control edit: ${cards} apps on the page, ${destroyed} destroyed`);
  }
  await page.getByRole('link', { name: 'Default' }).click();
  await story.getByText('Counter', { exact: true }).waitFor({ timeout: 5_000 });
  if (destroyed !== 2) throw new Error(`leaving a story destroyed ${destroyed - 1} apps, not 1`);

  await page.goto(`${url}?path=/docs/counter--docs`);
  await story.getByText('Hello from Storybook').first().waitFor({ timeout: 15_000 });
  // The primary story at the top, then each story: Default and Labelled.
  const docs = await story.getByTestId('card').count();
  if (docs !== 3) throw new Error(`the docs page shows ${docs} stories, not 3`);

  if (errors.length) throw new Error(`the page logged errors:\n${errors.join('\n')}`);
  return (
    'in Chromium: args set inputs, presses count, CSS and Tailwind apply, a control edit or a ' +
    'new story tears the last app down, and docs show every story'
  );
}

/**
 * The weekly checks against the newest versions each setup's ranges allow, one CI job each. `app`
 * is where the native app ends up, which is where its versions are read from.
 */
const SCENARIOS = {
  'template-npm': { app: 'app', run: (dir) => templateScenario(dir, 'npm') },
  'template-pnpm': { app: 'app', run: (dir) => templateScenario(dir, 'pnpm') },
  'angular-cli-npm': {
    app: 'web/projects/native',
    run: (dir) => angularWorkspace(dir, { latest: true }),
  },
  'nx-angular-npm': {
    app: 'monorepo/apps/mobile',
    run: (dir) => nxWorkspace(dir, { preset: 'angular-monorepo', pm: 'npm', latest: true }),
  },
  'nx-angular-pnpm': {
    app: 'monorepo/apps/mobile',
    run: (dir) =>
      nxWorkspace(dir, { preset: 'angular-monorepo', pm: 'pnpm', latest: true, port: 8093 }),
  },
  'nx-ts-npm': {
    app: 'monorepo/apps/mobile',
    run: (dir) => nxWorkspace(dir, { preset: 'ts', pm: 'npm', latest: true, port: 8094 }),
  },
  web: { app: 'web', run: webApp },
};

function templateScenario(dir, pm) {
  return `${check(generateApp(dir), { pm, latest: true })} modules`;
}

/** What a failure most likely moved under us. */
const REPORTED = {
  Angular: '@angular/core',
  Expo: 'expo',
  'React Native': 'react-native',
  Nx: 'nx',
  Vitest: 'vitest',
  TypeScript: 'typescript',
  Vite: 'vite',
};

/** The version of `name` the app resolves, looking up through `node_modules` as far as `top`. */
function resolvedVersion(name, app, top) {
  for (let dir = app; dir.startsWith(top); dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return readJson(manifest).version;
  }
  return undefined;
}

/** The versions a scenario ran on, in the log and, on GitHub Actions, in the job summary. */
function reportVersions(name, outcome, app, top) {
  const rows = Object.entries(REPORTED).map(
    ([label, pkg]) => `| ${label} | \`${pkg}\` | ${resolvedVersion(pkg, app, top) ?? '-'} |`,
  );
  const table = [
    `### ${name}: ${outcome}`,
    '',
    '| | Package | Resolved |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
}

async function runScenario(name) {
  const scenario = SCENARIOS[name];
  const dir = mkdtempSync(path.join(tmpdir(), `angular-native-${name}-`));
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
  try {
    console.log(`\nok  ${name}: the app bundles ${await scenario.run(dir)}, in ${elapsed()}`);
    reportVersions(name, `passed in ${elapsed()}`, path.join(dir, scenario.app), dir);
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    reportVersions(name, `failed after ${elapsed()}`, path.join(dir, scenario.app), dir);
    console.log(`the workspace is left in ${dir}`);
    rmSync(caches, { recursive: true, force: true });
    throw error;
  }
}

const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.split('=')[1];
if (scenario !== undefined && !SCENARIOS[scenario]) {
  throw new Error(`No scenario "${scenario}". There are: ${Object.keys(SCENARIOS).join(', ')}.`);
}

const GENERATORS = {
  angular: ['ng add @ng-native/schematics', angularWorkspace],
  nx: ['nx g @ng-native/nx:app', nxWorkspace],
};
const generators = process.argv.find((arg) => /^--generators(=|$)/.test(arg));
const onlyGenerator = generators?.split('=')[1];
if (onlyGenerator !== undefined && !Object.hasOwn(GENERATORS, onlyGenerator)) {
  throw new Error(
    `No generator "${onlyGenerator}". There are: ${Object.keys(GENERATORS).join(', ')}.`,
  );
}

// The packages publish their `dist`, so what goes out is what the build makes now.
run('pnpm', ['nx', 'run-many', '-t', 'build', '-p', '@ng-native/*'], root);
console.log(`publishing to ${REGISTRY}`);
publishAll();

if (scenario) {
  await runScenario(scenario);
} else if (process.argv.includes('--storybook')) {
  const dir = mkdtempSync(path.join(tmpdir(), 'angular-native-storybook-'));
  const started = Date.now();
  console.log(`\nok  the Storybook recipe builds and, ${await storybookApp(dir)}`);
  console.log(`    in ${Math.round((Date.now() - started) / 1000)}s`);
  rmSync(dir, { recursive: true, force: true });
} else {
  // One generator alone skips the template, which CI's distribution job checks on every commit:
  // the release runs each generator in a job of its own, and would otherwise check it twice more.
  if (!onlyGenerator) {
    const app = generateApp();
    const modules = check(app);
    console.log(`\nok  an app generated from the template bundles ${modules} modules`);
    rmSync(path.dirname(app), { recursive: true, force: true });
  }

  if (generators) {
    for (const [name, [what, generate]] of Object.entries(GENERATORS)) {
      if (onlyGenerator && onlyGenerator !== name) continue;
      const dir = mkdtempSync(path.join(tmpdir(), 'angular-native-workspace-'));
      console.log(`\nok  ${what}: the native app bundles ${await generate(dir)}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  if (process.argv.includes('--web')) {
    const dir = mkdtempSync(path.join(tmpdir(), 'angular-native-web-'));
    console.log(`\nok  a browser app on @ng-native/web bundles ${await webApp(dir)}`);
    rmSync(dir, { recursive: true, force: true });
  }
}
rmSync(caches, { recursive: true, force: true });
