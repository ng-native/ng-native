/**
 * `ng generate component` in an Angular Native project.
 *
 * Angular's own component schematic runs here too, and what it writes does not work on a device:
 * a `<p>` is not a native element, and its spec needs `TestBed` on a DOM that does not exist. This
 * writes the native equivalent, a component built from `<view>` and `<text>` with a test that
 * renders it on the fake Fabric, following the template's conventions: kebab-case files, no
 * `Component` suffix, an inline template, and a `.test.ts` beside it.
 */
const path = require('node:path').posix;
const { SchematicsException } = require('@angular-devkit/schematics');
const { strings } = require('@angular-devkit/core');
const { componentSource, testSource } = require('./sources.cjs');

/**
 * The directory the component goes in: the one `ng generate` was run from if that is inside the
 * project, the project's root otherwise.
 */
function directoryFor(workspace, options) {
  const project = workspace.projects?.[options.project];
  if (!project) {
    throw new SchematicsException(`angular.json has no project called "${options.project}".`);
  }
  const root = project.sourceRoot ?? project.root;
  const cwd = path.normalize(options.path ?? '');
  const inside = cwd === root || cwd.startsWith(root + '/');
  return { directory: inside ? cwd : root, prefix: project.prefix };
}

/**
 * @param {{ name: string, project: string, path?: string, flat?: boolean, skipTests?: boolean }} options
 */
function component(options) {
  return (tree) => {
    const workspace = JSON.parse(tree.readText('angular.json'));
    const { directory, prefix } = directoryFor(workspace, options);
    const file = strings.dasherize(path.basename(options.name));
    const folder = path.join(directory, path.dirname(options.name), options.flat ? '' : file);
    const className = strings.classify(file);
    const selector = prefix ? `${prefix}-${file}` : file;
    const label = `${file} works`;

    tree.create(path.join(folder, `${file}.ts`), componentSource(className, selector, label));
    if (!options.skipTests) {
      tree.create(path.join(folder, `${file}.test.ts`), testSource(className, file, label));
    }
  };
}

module.exports = { component };
