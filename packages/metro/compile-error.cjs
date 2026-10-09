/**
 * The Angular compiler's errors, as an error that says where they are.
 *
 * `@oxc-angular/vite` reports a template error with no position at all - its `labels` are empty -
 * so "Missing expected )" named the file and left the reader to search it. The message usually
 * quotes what it is about, though: the expression that did not parse, the block left open, the
 * tag closed twice. So that text is looked for in the component's template, the inline
 * `template:` or the `templateUrl` file, and when it is there exactly once, that is the line.
 *
 * It is a guess only in how it finds the text, never in what it claims. Found once, the error
 * carries the line, column and a code frame. Found more than once, it says which template and
 * that the line could not be told, rather than picking one. Not found at all - a quote the
 * template spells with an escape, or an error in a host binding rather than a template - and the
 * message is left as the compiler wrote it.
 */
const path = require('node:path');

/**
 * What a message quotes, as it would be written in the template.
 *
 * Each shape is one the compiler really produces: `... at the end of the expression [ label( ]`,
 * `Unexpected closing tag "view"`, `Unclosed block "@if"`, `@for loop must have a "track"
 * expression`, and a quoted name such as `Unrecognized trigger type "nothing"`.
 */
function quotedIn(message) {
  const expression = /(?:expression|in) \[(.*)\]$/s.exec(message);
  if (expression) return expression[1].trim() || null;
  const closing = /closing tag "([^"]+)"/.exec(message);
  if (closing) return `</${closing[1]}`;
  const block = /block "(@[\w-]+)"/.exec(message) ?? /^(@[\w-]+)/.exec(message);
  if (block) return block[1];
  const quoted = /"([^"]+)"/.exec(message);
  return quoted ? quoted[1] : null;
}

/** Where `needle` stands on its own in `text`: not inside a longer name at either end. */
function occurrences(text, needle) {
  const found = [];
  const word = /[\w-]/;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1];
    const after = text[at + needle.length];
    if (word.test(needle[0]) && before && word.test(before)) continue;
    if (word.test(needle.at(-1)) && after && word.test(after)) continue;
    found.push(at);
  }
  return found;
}

/**
 * The body of every inline `template:` in a file, as written, with where it starts.
 *
 * Found by scanning rather than parsing, because by the time this runs the compiler has already
 * parsed the file and said what is wrong with it. The body is the source text between the quotes,
 * escapes and all, so a line and column counted from it are the file's own.
 */
function inlineTemplates(src) {
  const bodies = [];
  const property = /\btemplate\s*:\s*(['"`])/g;
  for (let match = property.exec(src); match; match = property.exec(src)) {
    const quote = match[1];
    const start = match.index + match[0].length;
    let end = start;
    while (end < src.length && src[end] !== quote) end += src[end] === '\\' ? 2 : 1;
    bodies.push({ start, text: src.slice(start, end) });
    property.lastIndex = end + 1;
  }
  return bodies;
}

/** 1-based line and 0-based column, as Babel reports them. */
function position(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) };
}

/** Babel's code frame, uncoloured: two lines above, three below, and a caret under the column. */
function codeFrame(text, { line, column }) {
  const lines = text.split('\n');
  const first = Math.max(1, line - 2);
  const last = Math.min(lines.length, line + 3);
  const width = String(last).length;
  const frame = [];
  for (let at = first; at <= last; at++) {
    const gutter = ` ${String(at).padStart(width)} |`;
    const source = lines[at - 1];
    frame.push(`${at === line ? '>' : ' '}${gutter}${source ? ` ${source}` : ''}`);
    if (at === line) {
      const indent = source.slice(0, column).replace(/[^\t]/g, ' ');
      frame.push(` ${gutter.replace(/\d/g, ' ')} ${indent}^`);
    }
  }
  return frame.join('\n');
}

/**
 * Every template the file's components use: the inline ones in `src`, named for the component
 * whose class follows them, and the external ones by file.
 */
function templatesOf(src, filename, components, externals) {
  const classes = components.filter((component) => component.template != null);
  const inline = inlineTemplates(src).map((body) => {
    const owner = classes.find((component) => component.spanStart > body.start);
    return {
      file: filename,
      text: src,
      start: body.start,
      end: body.start + body.text.length,
      label: owner ? `${owner.className}'s template` : 'an inline template',
    };
  });
  const external = Object.entries(externals).map(([url, text]) => ({
    file: path.join(path.dirname(filename), url),
    text,
    start: 0,
    end: text.length,
    label: url,
  }));
  return [...inline, ...external];
}

/** One compiler error, with its place in the template when that can be told. */
function locate(message, templates) {
  const needle = quotedIn(message);
  if (!needle) return { message };

  const hits = templates.flatMap((template) =>
    occurrences(template.text.slice(template.start, template.end), needle).map((at) => ({
      template,
      offset: template.start + at,
    })),
  );
  if (!hits.length) return { message };

  if (hits.length > 1) {
    const owners = new Set(hits.map((hit) => hit.template));
    const where = owners.size === 1 ? hits[0].template.label : "one of this file's templates";
    return {
      message: `${message}\nThis is in ${where}, where "${needle}" appears ${hits.length} times, so the line cannot be told.`,
    };
  }

  const [{ template, offset }] = hits;
  const loc = position(template.text, offset);
  return { message, template, loc, frame: codeFrame(template.text, loc) };
}

/**
 * The error to throw for a file the compiler rejected.
 *
 * An inline template's error carries `loc`, the way a Babel error does, so Metro reports it at
 * that line of the component's file. An external template's does not: Metro would pin a `loc` on
 * the file it was transforming, the `.ts`, and send the reader to the right line of the wrong
 * file. Its message names the template file, line and column instead, with the same frame.
 */
function compileError(errors, filename, src, components, externals) {
  const templates = templatesOf(src, filename, components, externals);
  const located = errors.map((error) => locate(error.message ?? String(error), templates));
  const first = located.find((error) => error.loc);

  if (!first) {
    return new Error(`${filename}: ${located.map((error) => error.message).join('\n')}`);
  }

  const { template, loc, frame } = first;
  const rest = located.filter((error) => error !== first).map((error) => error.message);
  // Babel's `(line:column)` counts columns from 0; a `file:line:column` an editor opens, from 1.
  const head =
    template.file === filename
      ? `${filename}: ${first.message} (${loc.line}:${loc.column})`
      : `${filename}: ${first.message}\n  at ${template.file}:${loc.line}:${loc.column + 1}`;
  const error = /** @type {Error & { loc?: unknown }} */ (
    new Error([`${head}\n\n${frame}`, ...rest].join('\n\n'))
  );
  if (template.file === filename) error.loc = loc;
  return error;
}

module.exports = { compileError, codeFrame, inlineTemplates, position };
