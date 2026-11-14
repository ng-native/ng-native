/**
 * The rules a desktop app's declared spawn capabilities follow: which programs it may run, with
 * which arguments. Plain TypeScript with no imports, so the config plugin can check the declaration
 * at build time and `Processes` can refuse an undeclared call with a clear error before the
 * desktop host checks it again natively.
 *
 * An entry names a program and the arguments it may take:
 *
 *   { program: '/usr/bin/git', args: ['clone', '{url:https://\\S+}', '{dir:[\\w.-]+}'] }
 *
 * Each argument is a literal, matched exactly, or a `{name:regex}` placeholder. A placeholder
 * followed by `...` matches zero or more arguments, each by the same rules.
 *
 * - A placeholder's pattern is anchored: it matches the whole argument, so `{branch:[a-z]+}`
 *   never accepts `--upload-pack=...`.
 * - A placeholder never accepts an argument starting with `-` unless each alternative of its
 *   pattern starts with one, so an option cannot be injected where a value was declared.
 * - No argument may hold a NUL character, which a C string would cut short.
 * - Shells, `env` and other programs that run their arguments as a command are refused as
 *   programs, and so are Windows `.bat` and `.cmd` files, which `cmd.exe` re-parses (the BatBadBut
 *   class of bug). `spawn` never goes through a shell.
 * - A program is an absolute path, or a bare name resolved once at startup on a fixed search path
 *   (`SEARCH_PATH`), never the inherited `PATH`, and pinned there.
 *
 * The boundary guards against bugs and injected content, not against a hostile app.
 */

/** A spawn capability as `app.json` declares it. */
export interface SpawnCapability {
  /** An absolute path, or a bare name resolved on `SEARCH_PATH` at startup. */
  readonly program: string;
  /** Literal arguments and `{name:regex}` placeholders, in order. */
  readonly args?: readonly string[];
}

/** One declared argument, parsed. */
export type ArgumentRule =
  | { readonly kind: 'literal'; readonly value: string }
  | {
      readonly kind: 'placeholder';
      readonly name: string;
      readonly pattern: RegExp;
      /** Whether each alternative of the pattern starts with `-`, so the value may be an option. */
      readonly option: boolean;
      /** `{name:regex}...`: zero or more arguments. */
      readonly repeated: boolean;
    };

/** A spawn capability, checked and parsed. */
export interface CompiledCapability {
  readonly program: string;
  readonly args: readonly ArgumentRule[];
}

/** What a call that matched was given for each placeholder: a list for a repeated one. */
export type PlaceholderValues = Record<string, string | readonly string[]>;

/**
 * Where a bare program name is looked for, in order: the system's directories, then Homebrew's on
 * Apple silicon and on Intel. A Finder-launched app inherits only launchd's `PATH`, so Homebrew's
 * tools would never resolve on the inherited one.
 */
export const SEARCH_PATH: readonly string[] = [
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

/**
 * Programs refused whatever their path: shells, and programs whose job is to run their own
 * arguments as a command (`env`, `xargs`, `sudo`), which would turn an argument pattern into a
 * command line.
 */
const REFUSED_PROGRAMS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'csh',
  'tcsh',
  'fish',
  'nu',
  'env',
  'xargs',
  'sudo',
  'doas',
  'su',
  'osascript',
  'cmd',
  'powershell',
  'pwsh',
]);

/** Windows batch files, which run through `cmd.exe` and so re-parse their arguments. */
const REFUSED_EXTENSIONS = ['.bat', '.cmd'];

const PLACEHOLDER = /^\{([A-Za-z_][A-Za-z0-9_]*):([\s\S]+)\}(\.\.\.)?$/;

/** Why a declaration or a call was refused. */
export class SpawnRuleError extends Error {
  override readonly name = 'SpawnRuleError';
}

/** The last segment of a path, either separator, lower-cased and without `.exe`. */
function baseName(program: string): string {
  const last = program.split(/[\\/]/).at(-1) ?? '';
  return last.toLowerCase().replace(/\.exe$/, '');
}

/** Why `program` cannot be declared, or null when it can. */
export function programProblem(program: string): string | null {
  if (typeof program !== 'string' || program.length === 0) return 'a program is required';
  if (program.includes('\0')) return 'a program cannot hold a NUL character';
  if (program !== program.trim()) return 'a program cannot start or end with white space';
  const lower = program.toLowerCase();
  if (REFUSED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return `${program} is a batch file, which runs through cmd.exe and re-parses its arguments`;
  }
  const name = baseName(program);
  if (REFUSED_PROGRAMS.has(name)) {
    return `${program} runs its arguments as a command, so it cannot be declared`;
  }
  if (program.startsWith('/')) {
    const segments = program.split('/').slice(1);
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return `${program} is not a normalized absolute path`;
    }
    return null;
  }
  if (/[\\/]/.test(program)) {
    return `${program} is a relative path: give an absolute path or a bare name`;
  }
  if (program === '.' || program === '..') return `${program} is not a program`;
  return null;
}

/** Parse one declared argument. */
export function parseArgument(arg: string): ArgumentRule {
  if (typeof arg !== 'string') throw new SpawnRuleError('an argument must be a string');
  if (arg.includes('\0')) throw new SpawnRuleError('an argument cannot hold a NUL character');
  const placeholder = PLACEHOLDER.exec(arg);
  if (!placeholder) return { kind: 'literal', value: arg };
  const [, name, source, dots] = placeholder as unknown as [string, string, string, string?];
  let pattern: RegExp;
  try {
    // On its own first: a pattern that compiles alone has balanced groups, so one such as
    // `a)|(.*` cannot close the anchoring group early and escape it.
    new RegExp(source);
    // Anchored as a whole, so an alternation cannot escape it: `{x:a|b}` is `^(?:a|b)$`.
    pattern = new RegExp(`^(?:${source})$`);
  } catch (error) {
    throw new SpawnRuleError(`{${name}} has a pattern that does not compile: ${String(error)}`);
  }
  const option = alternatives(source).every((one) => /^\^?\\?-/.test(one));
  return { kind: 'placeholder', name, pattern, option, repeated: dots !== undefined };
}

/**
 * A pattern's top-level alternatives: `-v|.*` is `-v` and `.*`. A `|` in a group, in a class or
 * escaped is not one. The pattern has compiled, so its groups and classes are balanced.
 */
function alternatives(source: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (char === '\\') at++;
    else if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === '|' && depth === 0) {
      found.push(source.slice(start, at));
      start = at + 1;
    }
  }
  found.push(source.slice(start));
  return found;
}

/** Check and parse one declared capability. Throws `SpawnRuleError` on a bad declaration. */
export function compileCapability(capability: SpawnCapability): CompiledCapability {
  const problem = programProblem(capability?.program);
  if (problem) throw new SpawnRuleError(problem);
  if (capability.args !== undefined && !Array.isArray(capability.args)) {
    throw new SpawnRuleError(`${capability.program}: args must be a list`);
  }
  const args = (capability.args ?? []).map(parseArgument);
  const names = new Set<string>();
  let repeated = 0;
  for (const rule of args) {
    if (rule.kind !== 'placeholder') continue;
    if (names.has(rule.name)) {
      throw new SpawnRuleError(`${capability.program}: {${rule.name}} is declared twice`);
    }
    names.add(rule.name);
    if (rule.repeated) repeated++;
  }
  // Two repeated placeholders could share the arguments between them in more than one way.
  if (repeated > 1) {
    throw new SpawnRuleError(`${capability.program}: at most one placeholder may repeat`);
  }
  return { program: capability.program, args };
}

/** Whether one argument passes a placeholder. */
function passes(rule: Extract<ArgumentRule, { kind: 'placeholder' }>, arg: string): boolean {
  if (arg.startsWith('-') && !rule.option) return false;
  return rule.pattern.test(arg);
}

/** Whether one argument passes a rule. */
function fits(rule: ArgumentRule, arg: string): boolean {
  return rule.kind === 'literal' ? rule.value === arg : passes(rule, arg);
}

/**
 * Whether `args` fit a capability's argument rules, and the values its placeholders took; null
 * when they do not. The rules before a repeated placeholder take the first arguments, those after
 * it the last, and it takes what is left between, each by its own pattern.
 */
export function matchArguments(
  rules: readonly ArgumentRule[],
  args: readonly string[],
): PlaceholderValues | null {
  if (args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) return null;
  const at = rules.findIndex((rule) => rule.kind === 'placeholder' && rule.repeated);
  const head = at === -1 ? rules : rules.slice(0, at);
  const tail = at === -1 ? [] : rules.slice(at + 1);
  if (at === -1 ? args.length !== rules.length : args.length < head.length + tail.length) {
    return null;
  }
  const values: Record<string, string | readonly string[]> = {};
  const take = (rule: ArgumentRule, arg: string): boolean => {
    if (!fits(rule, arg)) return false;
    if (rule.kind === 'placeholder') values[rule.name] = arg;
    return true;
  };
  for (let index = 0; index < head.length; index++) {
    if (!take(head[index]!, args[index]!)) return null;
  }
  const tailStart = args.length - tail.length;
  for (let index = 0; index < tail.length; index++) {
    if (!take(tail[index]!, args[tailStart + index]!)) return null;
  }
  if (at !== -1) {
    const rule = rules[at] as Extract<ArgumentRule, { kind: 'placeholder' }>;
    const middle = args.slice(head.length, tailStart);
    if (!middle.every((arg) => passes(rule, arg))) return null;
    values[rule.name] = middle;
  }
  return values;
}

/** What `matchSpawn` answers for a call a capability allows. */
export interface SpawnMatch {
  readonly capability: CompiledCapability;
  /** The program to run: the declared absolute path, or the name as it was pinned. */
  readonly path: string;
  readonly values: PlaceholderValues;
}

/**
 * The capability that allows running `program` with `args`, or null when none does. `program` is
 * the declared path or name exactly: a bare name is never looked up on any `PATH` here, and only
 * runs where `resolved` pinned it.
 *
 * @param resolved where each declared bare name was pinned at startup, by `resolveProgram`
 */
export function matchSpawn(
  capabilities: readonly CompiledCapability[],
  program: string,
  args: readonly string[],
  resolved: Readonly<Record<string, string | null>> = {},
): SpawnMatch | null {
  for (const capability of capabilities) {
    const pinned = capability.program.startsWith('/')
      ? capability.program
      : (resolved[capability.program] ?? null);
    if (pinned === null) continue;
    if (program !== capability.program && program !== pinned) continue;
    const values = matchArguments(capability.args, args);
    if (values) return { capability, path: pinned, values };
  }
  return null;
}

/** What `resolveProgram` asks of the file system. */
export interface ProgramLookup {
  /** Whether an executable file is at `path`. */
  isExecutable(path: string): boolean;
  /**
   * Whether `path` is a developer tool stub that only runs `xcrun`, with no Command Line Tools
   * installed to run. Such a tool reports absent.
   */
  isStub?(path: string): boolean;
}

/**
 * Where a declared program runs from, pinned once at startup, or null when it is absent: not
 * found, or an `xcrun` stub without the Command Line Tools. A bare name is looked for on
 * `SEARCH_PATH` alone.
 */
export function resolveProgram(program: string, lookup: ProgramLookup): string | null {
  if (programProblem(program)) return null;
  const candidates = program.startsWith('/')
    ? [program]
    : SEARCH_PATH.map((dir) => `${dir}/${program}`);
  for (const candidate of candidates) {
    if (!lookup.isExecutable(candidate)) continue;
    return lookup.isStub?.(candidate) ? null : candidate;
  }
  return null;
}

/** The environment a spawned program gets: only the variables declared, of those given. */
export function filterEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  allowed: readonly string[],
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const name of allowed) {
    const value = Object.hasOwn(env, name) ? env[name] : undefined;
    if (typeof value === 'string' && !value.includes('\0')) filtered[name] = value;
  }
  return filtered;
}
