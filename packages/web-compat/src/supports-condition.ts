/**
 * A `@supports` condition, as `CSS.supports(conditionText)` and a `<style>` made at run time
 * read one: `not`, `and` and `or` over declarations in brackets and `selector()`. What a
 * declaration or a selector is supported by is the caller's to say. Anything else in brackets,
 * `font-tech()` say, is something this does not support, which is false. A condition that is
 * not one at all, `and` and `or` side by side with no brackets between them, throws.
 */
export interface Readers {
  declaration(property: string, value: string): boolean;
  selector(text: string): boolean;
}

class Unreadable extends Error {}

/** Where a condition is read up to, in the text of it. */
interface Reading {
  readonly text: string;
  at: number;
}

const skipSpace = (reading: Reading): void => {
  while (/\s/.test(reading.text[reading.at] ?? '')) reading.at++;
};

/** The word at the reading, `not`, `and` or `or`, where one is there with a space after it. */
function keyword(reading: Reading): string | undefined {
  const [, word] = /^(not|and|or)(?=\s)/i.exec(reading.text.slice(reading.at)) ?? [];
  if (word) reading.at += word.length;
  return word?.toLowerCase();
}

/** The text between a bracket at the reading and the one that closes it, past both. */
function bracketed(reading: Reading): string {
  const from = reading.at + 1;
  let depth = 0;
  for (let at = reading.at; at < reading.text.length; at++) {
    const letter = reading.text[at];
    if (letter === '(') depth++;
    else if (letter === ')' && --depth === 0) {
      reading.at = at + 1;
      return reading.text.slice(from, at);
    }
  }
  throw new Unreadable();
}

/** One term: a condition or a declaration in brackets, a `selector()`, or something else. */
function term(reading: Reading, readers: Readers): boolean {
  skipSpace(reading);
  const [, name] = /^([\w-]+)\(/.exec(reading.text.slice(reading.at)) ?? [];
  if (name) {
    reading.at += name.length;
    const inside = bracketed(reading);
    return name.toLowerCase() === 'selector' && readers.selector(inside);
  }
  if (reading.text[reading.at] !== '(') throw new Unreadable();
  const inside = bracketed(reading);
  const declared = /^\s*(--[\w-]+|[a-z-]+)\s*:([\s\S]*)$/i.exec(inside);
  if (declared) return readers.declaration(declared[1]!, declared[2]!);
  try {
    return condition({ text: inside, at: 0 }, readers);
  } catch {
    // Something in brackets that is no condition: nothing this supports.
    return false;
  }
}

function condition(reading: Reading, readers: Readers): boolean {
  skipSpace(reading);
  if (keyword(reading) === 'not') {
    const held = !term(reading, readers);
    ended(reading);
    return held;
  }
  const terms = [term(reading, readers)];
  let joined: string | undefined;
  for (skipSpace(reading); reading.at < reading.text.length; skipSpace(reading)) {
    const word = keyword(reading);
    if (!word || word === 'not' || (joined && word !== joined)) throw new Unreadable();
    joined = word;
    terms.push(term(reading, readers));
  }
  return joined === 'or' ? terms.includes(true) : !terms.includes(false);
}

function ended(reading: Reading): void {
  skipSpace(reading);
  if (reading.at < reading.text.length) throw new Unreadable();
}

/** Whether a condition holds, by what the readers support; false where it is no condition. */
export function supportsCondition(text: string, readers: Readers): boolean {
  try {
    return condition({ text, at: 0 }, readers);
  } catch (error) {
    if (error instanceof Unreadable) return false;
    throw error;
  }
}
