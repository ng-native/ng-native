/**
 * The component definitions in a module, read with a JavaScript parser.
 *
 * Two steps need a definition's `styles`: a release build empties the CSS Angular compiled into
 * each `ɵɵdefineComponent(...)`, and an opted-in library's CSS is read from each
 * `ɵɵngDeclareComponent(...)` before the linker shims it. Both want the property of that name on
 * the object the call is given, and nothing else called `styles`: an input whose class field is
 * named `styles` sits in the same object (`inputs: { styles: ["customStyles", "styles"] }`), a
 * template's text can read like the property, and a string elsewhere in the file can quote a whole
 * call. A parser tells those apart where a search of the text cannot.
 */
const { parse } = require('@babel/parser');

/**
 * Each call to `callee` in `code` whose argument is an object, with what its `type` and `styles`
 * properties hold.
 *
 * - `type` is the name of the class the definition belongs to, or null when it is not a name.
 * - `styles` is the extent of the property's value, `{ start, end }` as offsets into `code`, with
 *   `entries` when every entry is a string: each one's value as the string it means, and the line
 *   its literal starts on. `entries` is null when an entry is anything else, and `styles` is null
 *   when the object has no such property.
 *
 * Null when the module does not parse, including one the parser could only recover from by guessing.
 *
 * @param {string} code
 * @param {string} filename the module's path, whose extension says whether it is TypeScript
 * @param {'ɵɵdefineComponent' | 'ɵɵngDeclareComponent'} callee
 */
function componentDeclarations(code, filename, callee) {
  // The name also arrives escaped (`ɵɵdefineComponent`), which the parser reads as itself.
  if (!code.includes(callee.slice(2))) return [];

  let program;
  try {
    program = parse(code, {
      sourceType: 'unambiguous',
      plugins: pluginsFor(filename),
      allowReturnOutsideFunction: true,
    }).program;
  } catch {
    return null;
  }

  const found = [];
  for (const node of nodes(program)) {
    const argument = node.type === 'CallExpression' ? node.arguments[0] : null;
    if (argument?.type !== 'ObjectExpression' || calleeName(node.callee) !== callee) continue;
    found.push({
      start: node.start,
      end: node.end,
      type: classOf(property(argument, 'type')),
      styles: stylesOf(property(argument, 'styles')),
    });
  }
  return found;
}

/** The compiler leaves TypeScript syntax in an app's file; a library ships plain JavaScript. */
function pluginsFor(filename) {
  if (/\.[cm]?tsx$/.test(filename)) return ['typescript', 'jsx', 'decorators-legacy'];
  if (/\.[cm]?ts$/.test(filename)) return ['typescript', 'decorators-legacy'];
  return [];
}

/** Every node under `root`, without recursion: a library's bundle nests deeply. */
function* nodes(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    yield node;
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (typeof value[i]?.type === 'string') stack.push(value[i]);
        }
      } else if (typeof value?.type === 'string') {
        stack.push(value);
      }
    }
  }
}

/** `ɵɵdefineComponent` for `i0.ɵɵdefineComponent`, `ɵɵdefineComponent` or `i0["ɵɵdefineComponent"]`. */
function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type !== 'MemberExpression') return null;
  if (!callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  return callee.property.type === 'StringLiteral' ? callee.property.value : null;
}

/** The value of the object's own property called `name`, not one nested inside another. */
function property(object, name) {
  for (const entry of object.properties) {
    if (entry.type !== 'ObjectProperty' || entry.computed) continue;
    const key = entry.key.type === 'Identifier' ? entry.key.name : entry.key.value;
    if (key === name) return entry.value;
  }
  return null;
}

function classOf(value) {
  return value?.type === 'Identifier' ? value.name : null;
}

function stylesOf(value) {
  if (!value) return null;
  const elements = value.type === 'ArrayExpression' ? value.elements : null;
  const strings = elements?.every(isString);
  return {
    start: value.start,
    end: value.end,
    entries: strings
      ? elements.map((element) => ({ value: stringOf(element), line: element.loc.start.line }))
      : null,
  };
}

function isString(node) {
  return (
    node?.type === 'StringLiteral' ||
    (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
  );
}

function stringOf(node) {
  return node.type === 'StringLiteral' ? node.value : node.quasis[0].value.cooked;
}

module.exports = { componentDeclarations };
