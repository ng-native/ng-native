/**
 * `withDeviceTests(config)`: the Metro half of device component tests, active only when Metro is
 * started with `EXPO_PUBLIC_DEVICE_TESTS` set.
 *
 * A test file's `vitest` resolves to one bundle of Vitest's runner and its `describe`, `it` and
 * `expect`, built here from the app's own Vitest so the device and the Vitest process agree, with
 * the bundler the app's Vite already brings: Rolldown from Vite 8, esbuild from Vite 6 and 7, so an
 * app installs nothing more for it. It has to be bundled first: Metro refuses an `import()` with a
 * computed path, which Vitest's coverage and mocking code has, where as CommonJS it is a `require()`
 * Metro lets through to throw only if it is reached, which a device run never does.
 */
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/**
 * @param {import('metro-config').MetroConfig & { projectRoot: string }} config
 * @returns {typeof config}
 */
function withDeviceTests(config) {
  const resolve = config.resolver?.resolveRequest;
  const upstream = (context, name, platform) =>
    (resolve ?? context.resolveRequest)(context, name, platform);
  if (!process.env.EXPO_PUBLIC_DEVICE_TESTS) {
    // A development bundle still bundles what a dead branch requires: the app's check for this
    // variable is false, but without this the host, and Vitest behind it, would be in the bundle.
    const disabled = path.join(__dirname, '../src/device/host-disabled.ts');
    return {
      ...config,
      resolver: {
        ...config.resolver,
        resolveRequest: (context, name, platform) =>
          name === '@ng-native/testing/device/host'
            ? { type: 'sourceFile', filePath: disabled }
            : upstream(context, name, platform),
      },
    };
  }
  const runtime = buildRuntime(config.projectRoot);
  // Coverage counts what the app's own code does in a run: its source instrumented as Metro
  // transforms it, which changes every module's cache key, so only when asked.
  const coverage = Boolean(process.env.DEVICE_TESTS_COVERAGE);
  if (coverage) {
    process.env.NG_NATIVE_DEVICE_TESTS_TRANSFORMER = config.transformer?.babelTransformerPath;
  }
  return {
    ...config,
    transformer: {
      ...config.transformer,
      dynamicDepsInPackages: 'throwAtRuntime',
      ...(coverage ? { babelTransformerPath: path.join(__dirname, 'transformer.cjs') } : {}),
    },
    resolver: {
      ...config.resolver,
      resolveRequest: (context, name, platform) =>
        name === 'vitest'
          ? { type: 'sourceFile', filePath: runtime }
          : upstream(context, name, platform),
    },
  };
}

/** The runtime bundle for the project's Vitest, built once per version. */
function buildRuntime(projectRoot) {
  const manifest = require.resolve('vitest/package.json', { paths: [projectRoot] });
  const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
  const cache = path.join(projectRoot, 'node_modules/.cache/ng-native-device-testing');
  const out = path.join(cache, `vitest-${version}.cjs`);
  if (exists(out)) return out;
  mkdirSync(cache, { recursive: true });
  // Beside the bundle, so its `vitest` is the project's, not one this package might have of its own.
  const entry = path.join(cache, 'vitest-runtime-entry.mjs');
  writeFileSync(entry, readFileSync(path.join(__dirname, 'vitest-runtime-entry.mjs')));
  // Vite is Vitest's peer, so it resolves from Vitest's directory even where the app lists neither.
  const vite = path.dirname(
    require.resolve('vite/package.json', { paths: [path.dirname(manifest)] }),
  );
  const rolldown = resolveFrom(vite, 'rolldown');
  if (rolldown) {
    const script = path.join(__dirname, 'rolldown-runtime.mjs');
    const run = spawnSync(process.execPath, [script, rolldown, entry, out], {
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    if (run.status !== 0) {
      throw new Error(`In-app tests could not bundle Vitest ${version}:\n${run.stderr}`);
    }
    return out;
  }
  const esbuild = resolveFrom(vite, 'esbuild');
  if (!esbuild) {
    throw new Error(
      `In-app tests bundle Vitest with the Rolldown or esbuild its Vite brings, and found neither from ${vite}.`,
    );
  }
  require(esbuild).buildSync({
    entryPoints: [entry],
    absWorkingDir: projectRoot,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    target: 'es2020',
    outfile: out,
    logLevel: 'error',
  });
  return out;
}

function resolveFrom(directory, name) {
  try {
    return require.resolve(name, { paths: [directory] });
  } catch {
    return undefined;
  }
}

function exists(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

module.exports = { withDeviceTests };
