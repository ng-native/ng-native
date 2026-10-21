/**
 * Turns off `declarationMap` in each `tsconfig.typecheck.json` `@ng-native/nx:library` wrote.
 *
 * That config sets `composite: false` so `ngc` can run with `noEmit`, and Nx's TypeScript preset
 * turns `declarationMap` on in `tsconfig.base.json`. With neither `composite` nor `declaration`,
 * TypeScript stops with TS5069 before it checks anything, so `nx typecheck` fails. A config that
 * sets `declarationMap` itself, either way, is left as it is.
 */
const { files } = require('./host.cjs');
const { formatted } = require('./sync-app-versions.cjs');

/**
 * @param {import('./host.cjs').Host} host
 * @returns {string[]} the configs that are not plain JSON, which are left for the developer
 */
function libraryTypecheckDeclarationMap(host) {
  const notes = [];
  for (const file of files(host)) {
    if (file !== 'tsconfig.typecheck.json' && !file.endsWith('/tsconfig.typecheck.json')) continue;
    const original = host.read(file) ?? '';
    let config;
    try {
      config = JSON.parse(original);
    } catch {
      notes.push(
        `${file}: not plain JSON, so it was left as it is. If ngc reports TS5069 for it, add ` +
          '"declarationMap": false to its compilerOptions.',
      );
      continue;
    }
    // The generator's: ngc's options, over the library's own config. An app's extends its own.
    const generated = config.extends === './tsconfig.lib.json' && config.angularCompilerOptions;
    if (!generated || 'declarationMap' in (config.compilerOptions ?? {})) continue;
    config.compilerOptions = { ...config.compilerOptions, declarationMap: false };
    host.write(file, formatted(config, original));
  }
  return notes;
}

module.exports = { libraryTypecheckDeclarationMap };
