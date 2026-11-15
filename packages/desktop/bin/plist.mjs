/**
 * Property lists as XML, the form `Info.plist` and an entitlements file take. Strings, booleans,
 * whole numbers, lists and dictionaries; `undefined` and `null` values are left out.
 */

/**
 * @typedef {string | number | boolean | null | undefined | PlistArray | PlistDict} PlistValue
 * @typedef {Array<PlistValue>} PlistArray
 * @typedef {{ [key: string]: PlistValue }} PlistDict
 */

/**
 * @param {PlistDict} root
 * @returns {string}
 */
export function plist(root) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    ...value(root, ''),
    '</plist>',
    '',
  ].join('\n');
}

/**
 * @param {PlistValue} item
 * @param {string} indent
 * @returns {string[]}
 */
function value(item, indent) {
  if (typeof item === 'string') return [`${indent}<string>${escape(item)}</string>`];
  if (typeof item === 'boolean') return [`${indent}<${item}/>`];
  if (typeof item === 'number') {
    if (!Number.isInteger(item)) throw new Error(`plist: ${item} is not a whole number`);
    return [`${indent}<integer>${item}</integer>`];
  }
  if (Array.isArray(item)) {
    const items = item.filter((entry) => entry !== undefined && entry !== null);
    if (items.length === 0) return [`${indent}<array/>`];
    return [
      `${indent}<array>`,
      ...items.flatMap((entry) => value(entry, `${indent}\t`)),
      `${indent}</array>`,
    ];
  }
  if (item && typeof item === 'object') {
    const entries = Object.entries(item).filter(
      ([, entry]) => entry !== undefined && entry !== null,
    );
    if (entries.length === 0) return [`${indent}<dict/>`];
    return [
      `${indent}<dict>`,
      ...entries.flatMap(([key, entry]) => [
        `${indent}\t<key>${escape(key)}</key>`,
        ...value(entry, `${indent}\t`),
      ]),
      `${indent}</dict>`,
    ];
  }
  throw new Error(`plist: cannot write ${String(item)}`);
}

/** @param {string} text */
function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
