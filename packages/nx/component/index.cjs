/**
 * `nx g @ng-native/nx:component profile-card --project ui`: a component for an Angular Native app
 * or library.
 *
 * `@nx/angular:component` writes a `<p>` and a `TestBed` spec, neither of which works on a device
 * or on the fake Fabric. This writes what `@ng-native/schematics`' component schematic writes for
 * the Angular CLI: a component built from `<view>` and `<text>`, with an inline template, and a
 * `.test.ts` beside it that renders it. It goes under `src/lib` in a library and `src/app` in an
 * app, in a folder of its own unless `--flat`.
 */
const path = require('node:path').posix;
const { formatFiles, getProjects, joinPathFragments, names } = require('@nx/devkit');
const { componentSource, testSource } = require('./sources.cjs');

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ name: string, project: string, flat?: boolean, skipTests?: boolean, skipFormat?: boolean }} options
 */
async function component(tree, options) {
  const project = getProjects(tree).get(options.project);
  if (!project) throw new Error(`The workspace has no project called "${options.project}".`);
  const file = names(path.basename(options.name)).fileName;
  const base = joinPathFragments(
    project.root,
    'src',
    project.projectType === 'library' ? 'lib' : 'app',
    path.dirname(options.name),
  );
  const folder = options.flat ? base : joinPathFragments(base, file);
  writeComponent(tree, folder, file, project.prefix, options.skipTests);
  if (!options.skipFormat) await formatFiles(tree);
}

/**
 * The component `file` in `folder`, and its test unless `skipTests`. The library generator writes
 * its first component with this too.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {string} folder
 * @param {string} file the file name, kebab-case, without `.ts`
 * @param {string | undefined} prefix the project's selector prefix
 * @param {boolean} [skipTests]
 */
function writeComponent(tree, folder, file, prefix, skipTests = false) {
  const className = names(file).className;
  const selector = prefix ? `${prefix}-${file}` : file;
  const label = `${file} works`;
  tree.write(joinPathFragments(folder, `${file}.ts`), componentSource(className, selector, label));
  if (!skipTests) {
    tree.write(joinPathFragments(folder, `${file}.test.ts`), testSource(className, file, label));
  }
}

module.exports = { component, writeComponent };
