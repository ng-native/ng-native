/**
 * Gives each Angular Native project in `angular.json` a `typecheck` target, as `ng add` now writes.
 *
 * `ng run <project>:typecheck` runs `ngc` on the project, which checks its templates as well as its
 * code; without it a binding to an input a component does not have goes unchecked. A project is
 * Angular Native's when one of its targets runs one of `@ng-native/schematics`' builders. A
 * `typecheck` target the project already has, whatever runs it, stays.
 */
const { formatted } = require('./sync-app-versions.cjs');

const TARGET = { builder: '@ng-native/schematics:typecheck', options: {} };

/** @param {Record<string, { builder?: string }> | undefined} targets */
const isNative = (targets) =>
  Object.values(targets ?? {}).some((target) =>
    String(target?.builder).startsWith('@ng-native/schematics:'),
  );

/**
 * @param {import('./host.cjs').Host} host
 * @returns {string[]} what is left to do by hand: the target, when `angular.json` has comments or
 *   trailing commas, which the Angular CLI allows and rewriting it here would lose
 */
function nativeTypecheckTarget(host) {
  const original = host.read('angular.json');
  if (original === null) return [];
  let workspace;
  try {
    workspace = JSON.parse(original);
  } catch {
    return [
      'angular.json: not plain JSON, so no typecheck target was added. Give each Angular Native ' +
        'project one by hand: "typecheck": { "builder": "@ng-native/schematics:typecheck" } in its ' +
        'architect.',
    ];
  }
  let changed = false;
  for (const project of Object.values(workspace.projects ?? {})) {
    if (!project || typeof project !== 'object') continue;
    const targets = project.architect ?? project.targets;
    if (!isNative(targets) || targets.typecheck) continue;
    targets.typecheck = { ...TARGET };
    changed = true;
  }
  if (changed) host.write('angular.json', formatted(workspace, original));
  return [];
}

module.exports = { nativeTypecheckTarget };
