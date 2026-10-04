/**
 * A `.md` file as a module: `import post from './post.md'` is `{ attributes, content, tokens }`.
 *
 * `attributes` is the front matter, parsed with `front-matter`, the parser `@analogjs/content`
 * uses, so a file means the same thing here as in an Analog app on the web. `content` is the
 * Markdown after it, and `tokens` is `marked.lexer(content)`, made here so a screen that draws them
 * with `<markdown [tokens]>` parses nothing on the device.
 *
 * The module is a literal of plain JSON. A front matter date, which YAML reads as a `Date`, arrives
 * as its ISO string, and a token is a plain object either way.
 *
 * `marked` is an optional peer dependency of this package, needed only when the app has a `.md`
 * file in its bundle, and resolved from the app as well as from here.
 */
const path = require('node:path');
const frontMatter = require('front-matter');

/** @type {{ lexer(src: string): unknown[] } | undefined} */
let marked;

/**
 * `marked`, from this package or from the app: npm puts an optional peer beside the app rather
 * than beside the package that names it.
 */
function loadMarked() {
  if (marked) return marked;
  for (const paths of [[__dirname], [process.cwd()]]) {
    try {
      marked = require(require.resolve('marked', { paths }));
      return marked;
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  return undefined;
}

/**
 * The versions a cached `.md` transform depends on besides its own source, for the transformer's
 * cache key: a new `marked` lexes differently, and a new `front-matter` may read YAML differently.
 */
function markdownVersions() {
  return ['marked', 'front-matter']
    .map((name) => {
      for (const paths of [[__dirname], [process.cwd()]]) {
        try {
          const file = require.resolve(`${name}/package.json`, { paths });
          return `${name}@${require(file).version}`;
        } catch {
          // Not resolvable from here: try the next place, or leave it out.
        }
      }
      return `${name}@none`;
    })
    .join(',');
}

/**
 * @param {string} src the file as written
 * @param {string} filename for the error messages
 * @returns {string} an ES module whose default export is `{ attributes, content, tokens }`
 */
function markdownModule(src, filename) {
  const name = path.basename(filename);
  let parsed;
  try {
    // `front-matter` finds the fences in Windows line endings only when it runs on Windows.
    parsed = frontMatter(src.replace(/\r\n?/g, '\n'));
  } catch (error) {
    throw new Error(
      `${filename}: the front matter of ${name} is not valid YAML. ${error.message}`,
      { cause: error },
    );
  }
  const { attributes, body } = parsed;
  if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new Error(
      `${filename}: the front matter of ${name} must be a YAML mapping of names to values, ` +
        `such as "title: Hello", not ${Array.isArray(attributes) ? 'a list' : 'a single value'}.`,
    );
  }
  const lexer = loadMarked()?.lexer;
  if (!lexer) {
    throw new Error(
      `${filename}: a .md file is lexed with marked as it is bundled, and marked is not ` +
        'installed. Install it beside the app: npx expo install marked',
    );
  }
  const module = { attributes, content: body, tokens: lexer(body) };
  return `export default ${JSON.stringify(module)};\n`;
}

module.exports = { markdownModule, markdownVersions };
