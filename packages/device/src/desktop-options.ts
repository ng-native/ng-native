/**
 * The `@ng-native/desktop` plugin's options in `app.json`, and their validation. They hold only
 * what has to exist before JavaScript runs: the document types the app opens, its declared
 * capabilities (programs it spawns, environment variables it reads and paths outside its own
 * folders), and the libraries kept out of the desktop build.
 *
 *   ["@ng-native/desktop", {
 *     "documentTypes": [{ "name": "Markdown", "extensions": ["md"], "role": "editor" }],
 *     "capabilities": {
 *       "spawn": [{ "program": "git", "args": ["status", "--porcelain"] }],
 *       "env": ["HOME", "LANG"],
 *       "paths": [{ "path": "~/Projects", "access": "readwrite" }]
 *     },
 *     "deny": ["react-native-some-library"]
 *   }]
 *
 * Permissions are not here: the Expo keys (`ios.infoPlist`'s usage strings and each `expo-*`
 * plugin's permission option) declare them for every OS. Plain TypeScript with no Angular, so the
 * config plugin can run it in Node.
 */
import { SpawnRuleError, compileCapability, type SpawnCapability } from './spawn-rules.ts';

/** A kind of document the app opens from Finder, by its file extensions. */
export interface DocumentType {
  /** What Finder calls the kind, e.g. `Markdown`. */
  readonly name: string;
  /** File extensions without the dot, e.g. `md`. */
  readonly extensions: readonly string[];
  /** Whether the app edits these files or only views them. `editor` when unset. */
  readonly role?: 'editor' | 'viewer';
  /** Uniform type identifiers, where the kind has them, e.g. `net.daringfireball.markdown`. */
  readonly utis?: readonly string[];
  /** An icon in the app's assets for documents of this kind. */
  readonly icon?: string;
}

/** A path outside the app's own folders that it may use. */
export interface PathCapability {
  /** An absolute path, or one under the home folder written `~/...`. */
  readonly path: string;
  /** `read` unless it says `readwrite`. */
  readonly access?: 'read' | 'readwrite';
}

/** What the app may do beyond its own folders, the user's picks and the Expo-keyed permissions. */
export interface DesktopCapabilities {
  readonly spawn?: readonly SpawnCapability[];
  /** The environment variables `Processes.env` holds and a spawned program is given. */
  readonly env?: readonly string[];
  readonly paths?: readonly PathCapability[];
}

/** The plugin's options. */
export interface DesktopOptions {
  readonly documentTypes?: readonly DocumentType[];
  readonly capabilities?: DesktopCapabilities;
  /** npm packages whose native code stays out of the desktop build, even where they ship some. */
  readonly deny?: readonly string[];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXTENSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UTI = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PACKAGE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why a declared path cannot be used, or null when it can. */
export function pathProblem(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'a path is required';
  if (path.includes('\0')) return 'a path cannot hold a NUL character';
  const rooted = path.startsWith('/')
    ? path.slice(1)
    : path.startsWith('~/')
      ? path.slice(2)
      : null;
  if (rooted === null) return `${path} must be absolute, or start with ~/`;
  if (rooted === '') return `${path} would give the whole ${path === '/' ? 'disk' : 'home folder'}`;
  const segments = rooted.replace(/\/$/, '').split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return `${path} is not a normalized path`;
  }
  return null;
}

/**
 * The problems with a set of options, each naming where it is, e.g.
 * `capabilities.spawn[0].program: /bin/sh runs its arguments as a command`. Empty when there are
 * none. Unknown keys are problems too, so a misspelt key is not silently a capability missing.
 */
export function desktopOptionProblems(options: unknown): string[] {
  const problems: string[] = [];
  const report = (where: string, problem: string) => problems.push(`${where}: ${problem}`);
  if (options === undefined) return problems;
  if (!isRecord(options)) return ['options must be an object'];
  unknownKeys(options, ['documentTypes', 'capabilities', 'deny'], '', report);

  list(options['documentTypes'], 'documentTypes', report, (type, where) => {
    if (!isRecord(type)) {
      report(where, 'must be an object');
      return;
    }
    unknownKeys(type, ['name', 'extensions', 'role', 'utis', 'icon'], where, report);
    if (typeof type['name'] !== 'string' || type['name'] === '') {
      report(`${where}.name`, 'a name is required');
    }
    const extensions = type['extensions'];
    if (!Array.isArray(extensions) || extensions.length === 0) {
      report(`${where}.extensions`, 'at least one extension is required');
    }
    list(extensions, `${where}.extensions`, report, (extension, at) => {
      if (typeof extension !== 'string' || !EXTENSION.test(extension)) {
        report(at, `${JSON.stringify(extension)} is not an extension: write it without the dot`);
      }
    });
    if (type['role'] !== undefined && type['role'] !== 'editor' && type['role'] !== 'viewer') {
      report(`${where}.role`, "must be 'editor' or 'viewer'");
    }
    list(type['utis'], `${where}.utis`, report, (uti, at) => {
      if (typeof uti !== 'string' || !UTI.test(uti)) report(at, 'is not a type identifier');
    });
    if (type['icon'] !== undefined && typeof type['icon'] !== 'string') {
      report(`${where}.icon`, 'must be a string');
    }
  });

  const capabilities = options['capabilities'];
  if (capabilities !== undefined && !isRecord(capabilities)) {
    report('capabilities', 'must be an object');
  } else if (capabilities) {
    unknownKeys(capabilities, ['spawn', 'env', 'paths'], 'capabilities', report);
    list(capabilities['spawn'], 'capabilities.spawn', report, (entry, where) => {
      if (!isRecord(entry)) {
        report(where, 'must be an object');
        return;
      }
      unknownKeys(entry, ['program', 'args'], where, report);
      try {
        compileCapability(entry as unknown as SpawnCapability);
      } catch (error) {
        if (!(error instanceof SpawnRuleError)) throw error;
        report(where, error.message);
      }
    });
    list(capabilities['env'], 'capabilities.env', report, (name, where) => {
      if (typeof name !== 'string' || !ENV_NAME.test(name)) {
        report(where, `${JSON.stringify(name)} is not an environment variable name`);
      }
    });
    list(capabilities['paths'], 'capabilities.paths', report, (entry, where) => {
      if (!isRecord(entry)) {
        report(where, 'must be an object');
        return;
      }
      unknownKeys(entry, ['path', 'access'], where, report);
      const problem = pathProblem(entry['path'] as string);
      if (problem) report(`${where}.path`, problem);
      const access = entry['access'];
      if (access !== undefined && access !== 'read' && access !== 'readwrite') {
        report(`${where}.access`, "must be 'read' or 'readwrite'");
      }
    });
  }

  list(options['deny'], 'deny', report, (name, where) => {
    if (typeof name !== 'string' || !PACKAGE.test(name))
      report(where, 'is not an npm package name');
  });
  return problems;
}

/** Check a set of options, throwing one error that lists every problem. */
export function validateDesktopOptions(options: unknown): DesktopOptions {
  const problems = desktopOptionProblems(options);
  if (problems.length > 0) {
    throw new Error(
      `[@ng-native/desktop] The plugin options in app.json are not valid:\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
  }
  return (options ?? {}) as DesktopOptions;
}

/**
 * Whether `path` is inside one of the declared paths, with the access asked for. `home` is the
 * user's home folder, which `~/` stands for. A path with a `.` or `..` segment is refused rather
 * than resolved: the host resolves links and normalizes before it asks.
 */
export function pathAllowed(
  declared: readonly PathCapability[],
  path: string,
  home: string,
  access: 'read' | 'readwrite' = 'read',
): boolean {
  if (pathProblem(path) !== null || !path.startsWith('/')) return false;
  const target = path.replace(/\/$/, '');
  return declared.some((entry) => {
    if (pathProblem(entry.path) !== null) return false;
    if (access === 'readwrite' && entry.access !== 'readwrite') return false;
    const root = (
      entry.path.startsWith('~/') ? `${home}/${entry.path.slice(2)}` : entry.path
    ).replace(/\/$/, '');
    return target === root || target.startsWith(`${root}/`);
  });
}

function unknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  where: string,
  report: (where: string, problem: string) => void,
): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      report(
        where ? `${where}.${key}` : key,
        `is not an option (expected one of ${known.join(', ')})`,
      );
    }
  }
}

function list(
  value: unknown,
  where: string,
  report: (where: string, problem: string) => void,
  each: (item: unknown, where: string) => void,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    report(where, 'must be a list');
    return;
  }
  value.forEach((item, index) => each(item, `${where}[${index}]`));
}

export * from './spawn-rules.ts';
