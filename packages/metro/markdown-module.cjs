/**
 * A `.md` file as a module: `import post from './post.md'` is `{ attributes, content, tokens }`.
 *
 * `attributes` is the front matter, parsed with `front-matter`, the parser `@analogjs/content`
 * uses, so a file means the same thing here as in an Analog app on the web. `content` is the
 * Markdown after it, and `tokens` is `marked.lexer(content)`, made here so a screen that draws them
 * with `<markdown [tokens]>` parses nothing on the device.
 *
 * The module is plain JSON, read with `JSON.parse`, so a front matter key named `__proto__` is a key
 * like any other and not the object's prototype. A front matter date, which YAML reads as a `Date`,
 * arrives as its ISO string, and a token is a plain object either way. A token keeps no `raw`, its
 * source text, when `<markdown>` draws its type without it: that text, at every level of nesting,
 * made the module several times the size of the file.
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
 * The token types `markdownBlocks` in `@ng-native/components` draws without their `raw`: every
 * type `marked.lexer` makes. A type not here, from a marked extension, is drawn as its source text,
 * so it keeps its `raw`.
 */
const DRAWN_WITHOUT_RAW = new Set([
  'space',
  'code',
  'heading',
  'table',
  'hr',
  'blockquote',
  'list',
  'list_item',
  'checkbox',
  'paragraph',
  'html',
  'text',
  'def',
  'escape',
  'link',
  'image',
  'strong',
  'em',
  'codespan',
  'br',
  'del',
]);

/** JSON for `tokens`, each one of a type in `DRAWN_WITHOUT_RAW` without its `raw`. */
function tokensJson(tokens) {
  return JSON.stringify(tokens, function (key, inner) {
    return key === 'raw' && DRAWN_WITHOUT_RAW.has(this.type) ? undefined : inner;
  });
}

/**
 * `json` as a single-quoted JavaScript string: JSON has a double quote in every key and no
 * control character, so only a backslash, a single quote and the line and paragraph separators
 * need escaping.
 */
function stringLiteral(json) {
  return `'${json
    .replace(/[\\']/g, '\\$&')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;
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
  const json =
    `{"attributes":${JSON.stringify(attributes)},"content":${JSON.stringify(body)},` +
    `"tokens":${tokensJson(lexer(body))}}`;
  return `export default JSON.parse(${stringLiteral(json)});\n`;
}

module.exports = { markdownModule, markdownVersions };
