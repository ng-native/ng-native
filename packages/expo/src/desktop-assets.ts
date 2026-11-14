/**
 * expo-asset's `Asset.loadAsync` over the desktop host's `NgNativeAsset`, for `assets()` on macOS,
 * where expo-asset is an empty module. Each module resolves to its source as an image does (a file
 * in a packaged app, the dev server's url in development), and the host answers its file on this
 * Mac, downloading it first from the dev server, as expo-asset's `downloadAsync` does.
 */
import { desktopHost } from './desktop-host.ts';

type Expo = typeof import('expo-asset');

interface AssetHost {
  downloadAsync(uri: string, hash: string | null, type: string | null): Promise<string>;
}

/** What `loadAsync` answers for each module: the fields of expo's `Asset` an app reads. */
interface DesktopAsset {
  readonly name: string;
  readonly type: string;
  readonly hash: string | null;
  readonly uri: string;
  readonly localUri: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly downloaded: true;
}

/** The url's file name and its extension, and the `hash` the dev server's asset urls carry. */
function describe(uri: string): { name: string; type: string; hash: string | null } {
  const [path = '', query = ''] = uri.split(/[?#]/, 2);
  const file = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
  const dot = file.lastIndexOf('.');
  const hash = new URLSearchParams(query).get('hash');
  return {
    name: dot > 0 ? file.slice(0, dot) : file,
    type: dot > 0 ? file.slice(dot + 1) : '',
    hash,
  };
}

/** expo-asset's `Asset.loadAsync`, or null with no NgNativeAsset. */
export function desktopAssets(): Pick<Expo, 'Asset'> | null {
  const found = desktopHost<AssetHost>('NgNativeAsset');
  if (!found) return null;
  const host = found.module;

  async function load(module: number | string): Promise<DesktopAsset> {
    let uri = module as string;
    let width: number | null = null;
    let height: number | null = null;
    if (typeof module === 'number') {
      const { Image } = require('react-native') as typeof import('react-native');
      const source = Image.resolveAssetSource(module);
      if (!source?.uri) throw new Error(`Asset: module ${module} is not an asset`);
      uri = source.uri;
      width = source.width ?? null;
      height = source.height ?? null;
    }
    const { name, type, hash } = describe(uri);
    const localUri = await host.downloadAsync(uri, hash, type || null);
    return { name, type, hash, uri, localUri, width, height, downloaded: true };
  }

  const Asset = {
    loadAsync: (modules: number | string | (number | string)[]) =>
      Promise.all((Array.isArray(modules) ? modules : [modules]).map(load)),
  };
  return { Asset } as unknown as Pick<Expo, 'Asset'>;
}
