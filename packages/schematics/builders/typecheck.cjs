/**
 * `@ng-native/schematics:typecheck`: the project's code and templates, checked by `ngc`.
 *
 * `tsc` reads no template, so a binding to an input a component does not have passes it. The Metro
 * config is loaded first, as the template's `typecheck` script does: once Tailwind is added, it
 * writes the sheet `src/main.ts` imports, which a fresh checkout does not have.
 */
const { createBuilder } = require('@angular-devkit/architect');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { projectRoot, resolveBin, spawnFile } = require('./spawn-bin.cjs');

/**
 * @param {import('@angular-devkit/architect').BuilderContext} context
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function runTypecheck(context) {
  const cwd = await projectRoot(context);
  // A project without one has no Tailwind sheet to write either.
  const metroConfig = path.join(cwd, 'metro.config.js');
  if (existsSync(metroConfig)) {
    const config = await spawnFile(metroConfig, [], cwd, 'node metro.config.js', context);
    if (!config.success) return config;
  }
  const ngc = resolveBin('@angular/compiler-cli', cwd, 'ngc');
  return spawnFile(ngc, ['-p', 'tsconfig.json', '--noEmit'], cwd, 'ngc', context);
}

module.exports = createBuilder((_options, context) => runTypecheck(context));
module.exports.runTypecheck = runTypecheck;
