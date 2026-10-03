/**
 * `@oxc-angular/vite` reads a component's `host` only as an object literal, entry by entry: a
 * key with a string, or a constant declared in the same file that holds one. A spread, a method,
 * or a `host` that is itself a constant or a call is dropped with no error, so the listeners
 * never fire, the attributes never appear, and every `:host([data-...])` rule stops matching.
 * Angular's own compiler evaluates those, so `ngc` accepts the same file.
 *
 * This finds each entry the compiler dropped, so the build can fail naming it, as
 * `styles-expression.cjs` does for `styles`: it asks the compiler again, one entry at a time.
 */
const { extractComponentMetadataSync } = require('@oxc-angular/vite/api');
const { close, decoratorProperty, split, trim } = require('./styles-expression.cjs');

/** How many host entries the compiler read. */
function read(host) {
  if (!host) return 0;
  const lists = host.properties.length + host.attributes.length + host.listeners.length;
  return lists + (host.classAttr === undefined ? 0 : 1) + (host.styleAttr === undefined ? 0 : 1);
}

/** The compiler's reading of `className`'s host, with its `host` value replaced by `text`. */
function hostWith(src, filename, className, value, text) {
  const probe = `${src.slice(0, value.start)}${text}${src.slice(value.end)}`;
  return extractComponentMetadataSync(probe, filename).find(
    (candidate) => candidate.className === className,
  )?.host;
}

/** Every `host` entry of `component` the compiler dropped, as its source text. */
function unreadHost(src, filename, component) {
  const value = decoratorProperty(src, component.spanStart, 'host');
  if (!value) return [];
  const text = src.slice(value.start, value.end);
  // Not an object literal: the compiler reads none of it.
  if (!text.startsWith('{') || close(src, value.start) !== value.end) return [text];
  const entries = split(src, value.start + 1, value.end - 1, ',')
    .map((piece) => trim(src, piece))
    .filter((entry) => entry.text);
  // All read, which is nearly every component: nothing to ask about.
  if (read(component.host) === entries.length) return [];
  return entries
    .filter(
      (entry) => !read(hostWith(src, filename, component.className, value, `{${entry.text}}`)),
    )
    .map((entry) => entry.text);
}

/** Fail the build on any component whose `host` has an entry the compiler dropped. */
function assertHostRead(src, filename, components) {
  for (const component of components ?? []) {
    const unread = unreadHost(src, filename, component);
    if (!unread.length) continue;
    const list = unread.map((text) => JSON.stringify(text.replace(/\s+/g, ' '))).join(', ');
    throw new Error(
      `${filename}: ${component.className}'s host cannot be read at build time: ${list}. ` +
        'The build reads a host object written out in the decorator, each entry a key with a ' +
        'string or a constant from the same file. It cannot follow a spread, a method, or a ' +
        'host that is a constant or a call. Write the bindings out in the literal.',
    );
  }
}

module.exports = { assertHostRead };
