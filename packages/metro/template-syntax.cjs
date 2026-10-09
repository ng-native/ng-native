/**
 * A template read by Angular's own parser, for the errors `@oxc-angular/vite` does not report.
 *
 * Through 0.0.40 it compiles a block whose parameters never close (`@if (on() {`) without an
 * error: everything before the block compiles and the rest of the template is dropped, so a
 * screen shows only what came before it, in a hot reload, under a test and in a production export
 * alike. Angular reports it, with a position, from the lexer and tree builder alone, so that is
 * all this runs: no expression parsing and no code generation.
 *
 * Only asked once the compiler has reported nothing, so an error it does report is still the one
 * a reader sees, and this is one parse of a template per compile.
 */
const path = require('node:path');
const { HtmlParser } = require('@angular/compiler');
const { codeFrame, inlineTemplates, position } = require('./compile-error.cjs');

/** The options Angular's `parseTemplate` gives the parser, so the two agree on what parses. */
const PARSE = { tokenizeExpansionForms: true, tokenizeBlocks: true, tokenizeLet: true };

/** The first error in a template, with its offset into it, or null when it parses. */
function firstError(template, url) {
  const [error] = new HtmlParser().parse(template, url, PARSE).errors;
  return error ? { message: error.msg, offset: error.span.start.offset } : null;
}

/**
 * Throw if any component's template does not parse, naming the component and where.
 *
 * An inline template is placed in the `.ts` file, with a `loc` Metro reports it at, when its text
 * is written with no escapes, so an offset into it is an offset into the file. An external one is
 * named by its own file, line and column, and carries no `loc`, which Metro would pin on the `.ts`.
 */
function assertTemplatesParse(src, filename, components, resources) {
  const bodies = inlineTemplates(src);
  for (const component of components ?? []) {
    const url = component.templateUrl;
    const template = component.template ?? resources?.templates?.[url];
    if (typeof template !== 'string') continue;
    const error = firstError(template, url ?? filename);
    if (!error) continue;

    const head = `${filename}: ${component.className}'s template does not parse: ${error.message}`;
    if (component.template == null) {
      throw externalError(head, path.join(path.dirname(filename), url), template, error.offset);
    }
    // The template's own body is the last one written before its class.
    const body = bodies.filter((one) => one.start < component.spanStart).at(-1);
    throw body?.text === template
      ? inlineError(head, src, body.start + error.offset)
      : new Error(head);
  }
}

/** The error for an inline template, at its place in the file and with the `loc` Metro reads. */
function inlineError(head, src, offset) {
  const loc = position(src, offset);
  const error = /** @type {Error & { loc?: unknown }} */ (
    new Error(`${head} (${loc.line}:${loc.column})\n\n${codeFrame(src, loc)}`)
  );
  error.loc = loc;
  return error;
}

/** The error for a template file, placed by its own name, line and column. */
function externalError(head, file, template, offset) {
  const loc = position(template, offset);
  return new Error(
    `${head}\n  at ${file}:${loc.line}:${loc.column + 1}\n\n${codeFrame(template, loc)}`,
  );
}

/** Throw if an external template does not parse, as its own module does when it is edited. */
function assertTemplateFileParses(template, file, owner) {
  const error = firstError(template, file);
  if (!error) return;
  throw externalError(
    `${file}: ${owner}'s template does not parse: ${error.message}`,
    file,
    template,
    error.offset,
  );
}

module.exports = { assertTemplatesParse, assertTemplateFileParses };
