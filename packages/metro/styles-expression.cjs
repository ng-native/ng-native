/**
 * `@oxc-angular/vite` reads a component's `styles` only when each entry is a string literal, a
 * template literal, or a constant declared in the same file that holds one. Any other entry - an
 * imported constant, a `+` concatenation, a spread, a constant holding an array, a call - is
 * dropped with no error, from the compiled definition and from the metadata this pipeline compiles
 * the native sheet from. The component renders unstyled, and the sheet's own build-time checks
 * never run on the CSS that was lost.
 *
 * This finds each entry the compiler dropped, so the build can fail naming it. It reads the
 * decorator's source text: the compiler reports nothing about what it skipped, so the check asks
 * it again, one entry at a time, and an entry it answers with no string for is one it dropped.
 */
const { extractComponentMetadataSync } = require('@oxc-angular/vite/api');

const LITERAL = /^(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)$/s;

/**
 * Index just past the string, template literal or comment starting at `i`, or `i` itself when
 * there is none there. A template literal's substitutions are skipped as code, so a quote or a
 * brace inside one is not mistaken for the literal's end.
 */
function skip(code, i) {
  const character = code[i];
  if (character === '/' && code[i + 1] === '/') return upTo(code, '\n', i, 0);
  if (character === '/' && code[i + 1] === '*') return upTo(code, '*/', i + 2, 2);
  if (character === "'" || character === '"') return skipQuoted(code, i);
  if (character === '`') return skipTemplate(code, i);
  return i;
}

/** Index of `marker` from `from` plus `past`, or the end of the code when it is not there. */
function upTo(code, marker, from, past) {
  const end = code.indexOf(marker, from);
  return end === -1 ? code.length : end + past;
}

function skipQuoted(code, i) {
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') j++;
    else if (code[j] === code[i] || code[j] === '\n') return j + 1;
  }
  return code.length;
}

function skipTemplate(code, i) {
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') j++;
    else if (code[j] === '`') return j + 1;
    else if (code[j] === '$' && code[j + 1] === '{') j = close(code, j + 1) - 1;
  }
  return code.length;
}

/** Index just past the bracket that closes the one at `open`, or the end of the code. */
function close(code, open) {
  let depth = 0;
  for (let i = open; i < code.length;) {
    const next = skip(code, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const character = code[i];
    if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character) && --depth === 0) return i + 1;
    i++;
  }
  return code.length;
}

/**
 * The top-level pieces of `code[from, to)` split at `separator`, each with its offset. Brackets,
 * strings and comments nest; only a separator outside all of them splits.
 */
function split(code, from, to, separator) {
  const pieces = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to;) {
    const next = skip(code, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const character = code[i];
    if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character)) depth--;
    else if (character === separator && depth === 0) {
      pieces.push({ start, end: i });
      start = i + 1;
    }
    i++;
  }
  pieces.push({ start, end: to });
  return pieces;
}

/** Comments and whitespace around a piece of code removed, with where what is left starts. */
function trim(code, { start, end }) {
  let first = -1;
  let last = start;
  for (let i = start; i < end;) {
    const next = skip(code, i);
    const comment = next !== i && code[i] === '/';
    if (!comment && !/\s/.test(code[i])) {
      if (first === -1) first = i;
      last = Math.max(next, i + 1);
    }
    i = Math.max(next, i + 1);
  }
  if (first === -1) return { start, end: start, text: '' };
  last = Math.min(last, end);
  return { start: first, end: last, text: code.slice(first, last) };
}

/**
 * Where the last `@Component` before `classStart` is, or -1. One written in a comment or a string
 * between the decorator and the class is not it.
 */
function lastDecorator(src, classStart) {
  let found = -1;
  for (let i = 0; i < classStart;) {
    const next = skip(src, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (src.startsWith('@Component', i)) found = i;
    i += 1;
  }
  return found;
}

/**
 * Where the `class` keyword of the class whose span starts at `from` is: the first one outside a
 * string, a comment and a decorator's arguments, where `class` is also a host key.
 */
function classKeyword(src, from) {
  for (let i = from; i < src.length;) {
    const next = skip(src, i);
    if (next !== i) i = next;
    else if (src[i] === '(') i = close(src, i);
    else if (/^class\b/.test(src.slice(i, i + 6)) && !/[\w$.]/.test(src[i - 1] ?? '')) return i;
    else i += 1;
  }
  return from;
}

/**
 * The `name` property of the `@Component({...})` decorating the class that starts at
 * `classStart`: where its value is in the source, or null when the decorator has none.
 */
function decoratorProperty(src, classStart, name) {
  // The compiler's span for a class starts at its decorator unless the class is exported, where
  // it starts at `export`: the `class` keyword is past the decorator either way.
  const keyword = classKeyword(src, classStart);
  const decorator = lastDecorator(src, keyword);
  if (decorator === -1) return null;
  const open = src.indexOf('{', decorator);
  if (open === -1 || open > keyword) return null;
  const end = close(src, open) - 1;

  for (const property of split(src, open + 1, end, ',')) {
    const { start, text } = trim(src, property);
    const key = new RegExp(`^(?:${name}|'${name}'|"${name}")\\s*(:|$)`).exec(text);
    if (!key) continue;
    // `styles,` shorthand is a variable of that name: the whole property is the expression.
    if (!key[1]) return { start, end: start + text.length };
    return trim(src, { start: start + key[0].length, end: property.end });
  }
  return null;
}

/** The entries of a `styles` value: the elements of an array, or the value itself. */
function entries(src, value) {
  const text = src.slice(value.start, value.end);
  if (text.startsWith('[') && close(src, value.start) === value.end) {
    return split(src, value.start + 1, value.end - 1, ',')
      .map((piece) => trim(src, piece))
      .filter((entry) => entry.text);
  }
  return [{ ...value, text }];
}

/** Whether the compiler reads `entry` when it is the component's only style. */
function readable(src, filename, className, value, entry) {
  const probe = `${src.slice(0, value.start)}[${entry.text}]${src.slice(value.end)}`;
  const component = extractComponentMetadataSync(probe, filename).find(
    (candidate) => candidate.className === className,
  );
  return (component?.styles ?? []).length > 0;
}

/** Every `styles` entry of `component` the compiler dropped, as its source text. */
function unreadStyles(src, filename, component) {
  const value = decoratorProperty(src, component.spanStart, 'styles');
  if (!value) return [];
  return entries(src, value)
    .filter((entry) => !LITERAL.test(entry.text))
    .filter((entry) => !readable(src, filename, component.className, value, entry))
    .map((entry) => entry.text);
}

/** Fail the build on any component whose `styles` has an entry the compiler dropped. */
function assertStylesRead(src, filename, components) {
  for (const component of components ?? []) {
    const unread = unreadStyles(src, filename, component);
    if (!unread.length) continue;
    const list = unread.map((text) => JSON.stringify(text.replace(/\s+/g, ' '))).join(', ');
    throw new Error(
      `${filename}: ${component.className}'s styles cannot be read at build time: ${list}. ` +
        "The build compiles a component's CSS from its source, and reads a string literal, a " +
        'template literal, a constant declared in the same file that holds one of those, or an ' +
        'array of them. It cannot follow an import, a concatenation with +, a spread, a constant ' +
        'holding an array, or a call. Put CSS shared between files in a .css file and list it in ' +
        'styleUrl or styleUrls; write a concatenation of same-file constants as a template literal.',
    );
  }
}

module.exports = { assertStylesRead, close, decoratorProperty, split, trim };
