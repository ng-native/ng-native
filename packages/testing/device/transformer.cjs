/**
 * Metro's Babel transformer for a device test run with coverage: the app's own transformer, then
 * the app's own source instrumented with istanbul, counting into `globalThis.__coverage__`, which
 * the test host reports to Vitest's istanbul provider after each run.
 *
 * `withDeviceTests()` puts this in place when Metro is started with `DEVICE_TESTS_COVERAGE` set,
 * and passes the app's transformer in `NG_NATIVE_DEVICE_TESTS_TRANSFORMER`.
 */
const path = require('node:path');

const upstream = require(process.env.NG_NATIVE_DEVICE_TESTS_TRANSFORMER);

/** The project's own source: not a package, not a test. */
function instrumented(filename) {
  return (
    /\.[cm]?[jt]sx?$/.test(filename) &&
    !filename.startsWith('..') &&
    !filename.includes('node_modules') &&
    !/\.(device|test|spec)\.[cm]?[jt]sx?$/.test(filename)
  );
}

/** The instrumenter Vitest's istanbul provider uses, from the project's own install of it. */
function instrumenter(projectRoot) {
  const provider = require.resolve('@vitest/coverage-istanbul/package.json', {
    paths: [projectRoot],
  });
  const entry = require.resolve('@vitest/istanbul-lib-instrument', {
    paths: [path.dirname(provider)],
  });
  return require(entry);
}

function instrument(result, params) {
  const projectRoot = params.options.projectRoot;
  const babel = require(require.resolve('@babel/core', { paths: [projectRoot] }));
  const { programVisitor } = instrumenter(projectRoot);
  const file = path.resolve(projectRoot, params.filename);
  let visitor;
  // The AST's positions are the source file's (the app's transformer maps them back), so the
  // coverage is too.
  babel.traverse(result.ast, {
    Program: {
      enter(program) {
        visitor = programVisitor(babel.types, file, {
          coverageVariable: '__coverage__',
          coverageGlobalScope: 'globalThis',
          coverageGlobalScopeFunc: false,
        });
        visitor.enter(program);
      },
      exit(program) {
        visitor.exit(program);
      },
    },
  });
  return result;
}

module.exports = {
  ...upstream,
  getCacheKey(...args) {
    return `${upstream.getCacheKey?.(...args) ?? ''}:device-tests-coverage`;
  },
  transform(params) {
    const result = upstream.transform(params);
    if (!instrumented(params.filename)) return result;
    return typeof result?.then === 'function'
      ? result.then((done) => instrument(done, params))
      : instrument(result, params);
  },
};
