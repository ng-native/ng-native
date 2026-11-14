/**
 * `withDeviceTests(config)`: the Metro half of device component tests, active only when Metro is
 * started with `EXPO_PUBLIC_DEVICE_TESTS` set.
 *
 * A test file's `vitest` resolves to one bundle of Vitest's runner and its `describe`, `it` and
 * `expect`, built here with esbuild from the app's own Vitest so the device and the Vitest process
 * agree. It has to be bundled first: Metro refuses an `import()` with a computed path, which
 * Vitest's coverage and mocking code has, where as CommonJS it is a `require()` Metro lets through
 * to throw only if it is reached, which a device run never does.
 */
const { mkdirSync, readFileSync, statSync } = require('node:fs');
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
  const out = path.join(
    projectRoot,
    'node_modules/.cache/ng-native-device-testing',
    `vitest-${version}.cjs`,
  );
  if (exists(out)) return out;
  mkdirSync(path.dirname(out), { recursive: true });
  require('esbuild').buildSync({
    entryPoints: [path.join(__dirname, 'vitest-runtime-entry.mjs')],
    // The project's Vitest, not one this package might have of its own.
    nodePaths: [path.join(path.dirname(manifest), '..')],
    absWorkingDir: projectRoot,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    target: 'es2020',
    outfile: out,
    logLevel: 'warning',
  });
  return out;
}

function exists(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

module.exports = { withDeviceTests };
