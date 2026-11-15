/**
 * `Shell`: hand a url, a file or a folder to the OS. Absent on iOS, Android and the web, where
 * each call does nothing and resolves false.
 *
 * The host contract, on the `NgNativeShell` module: `openExternal(url)`, `openPath(path)` and
 * `showItemInFolder(path)`, each answering whether the OS took it. NSWorkspace on macOS.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

export interface NativeShell {
  openExternal(url: string): Promise<boolean>;
  openPath(path: string): Promise<boolean>;
  showItemInFolder(path: string): Promise<boolean>;
}

/** Schemes `openExternal` refuses: a file is `openPath`'s, and the rest run or embed content. */
const REFUSED_SCHEMES = new Set(['file:', 'javascript:', 'data:', 'vbscript:', 'blob:']);

/** A url's scheme, which it must start with: nothing before it, as RFC 3986 writes one. */
const SCHEME = /^([a-zA-Z][a-zA-Z\d+.-]*):/;

function shellSource(): NativeShell | null {
  const module = reactNative()?.TurboModuleRegistry?.get?.('NgNativeShell') as
    Partial<NativeShell> | null | undefined;
  if (!module) return null;
  return {
    openExternal: async (url) => (await module.openExternal?.(url)) === true,
    openPath: async (path) => (await module.openPath?.(path)) === true,
    showItemInFolder: async (path) => (await module.showItemInFolder?.(path)) === true,
  };
}

/** Whether `path` is absolute and normalized: no `.` or `..` to walk out of where it says. */
function plainPath(path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) return false;
  return !path
    .slice(1)
    .split('/')
    .some((segment) => segment === '.' || segment === '..' || segment === '');
}

@Service()
export class Shell {
  /** Overridden in a test with a fake host. */
  static readonly SOURCE = new InjectionToken<NativeShell | null>('angular-native.shellSource', {
    factory: shellSource,
  });

  private readonly native = inject(Shell.SOURCE);

  /** Whether the OS takes urls, files and folders from the app: macOS. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /**
   * Open `url` in the app the user chose for its scheme: a web page in their browser, a `mailto:`
   * in their mail app. Resolves false for a url that does not start with a scheme, or one whose
   * scheme runs or embeds content (`javascript:`, `data:`) or is a file (`file:`, `openPath`'s).
   */
  async openExternal(url: string): Promise<boolean> {
    // Read here rather than by `URL`: React Native's keeps a leading space or control character
    // a browser trims, and then reports no scheme at all, so a refused one would get through.
    const scheme = typeof url === 'string' ? SCHEME.exec(url)?.[1]?.toLowerCase() : undefined;
    if (scheme === undefined || REFUSED_SCHEMES.has(`${scheme}:`)) return false;
    return (await this.native?.openExternal(url)) ?? false;
  }

  /** Open a file or folder in its default app, as a double click in Finder does. */
  async openPath(path: string): Promise<boolean> {
    if (!plainPath(path)) return false;
    return (await this.native?.openPath(path)) ?? false;
  }

  /** Show a file or folder selected in a Finder window. */
  async showItemInFolder(path: string): Promise<boolean> {
    if (!plainPath(path)) return false;
    return (await this.native?.showItemInFolder(path)) ?? false;
  }
}
