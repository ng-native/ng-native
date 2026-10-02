/**
 * `MediaLibrary`, bound to `expo-media-library`: saving to and reading from the user's photos and
 * videos.
 *
 * ```ts
 * import { AssetField, MediaLibrary, MediaType } from '@ng-native/expo/media-library';
 *
 * private readonly library = inject(MediaLibrary);
 *
 * async keep(uri: string): Promise<void> {
 *   await this.library.save(uri);
 * }
 *
 * async recentPhotos(): Promise<Asset[]> {
 *   if (!(await this.library.permission.ensure())) return [];
 *   return this.library.assets((query) =>
 *     query.eq(AssetField.MEDIA_TYPE, MediaType.IMAGE).orderBy(AssetField.CREATION_TIME).limit(30),
 *   );
 * }
 * ```
 *
 * The module's API is its classes: an `Asset` and an `Album` are handles whose details are read
 * with their own async getters, and a `Query` is built by chaining. This service is where they
 * are reached from, so a test can provide all three, and where the two permissions are: full
 * access to read the library, and the write-only access saving needs, which is the one to ask for
 * when that is all the app does.
 *
 * Changes to the library are a signal, but only once `watch()` is called: starting the listener
 * reads the library, which is not something to do before the user has granted access.
 *
 * Without the module installed, every query answers empty, saving answers null, and the
 * permissions are refused.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import type {
  Album,
  Asset,
  AssetField as ExpoAssetField,
  AssetMetadata,
  MediaLibraryAssetsChangeEvent,
  MediaType as ExpoMediaType,
  Query,
} from 'expo-media-library';
import { expoModule } from './native.ts';
import { Permission, UNAVAILABLE } from './permissions.ts';

type Expo = typeof import('expo-media-library');

/** The module's functions and classes this service calls. A test provides fakes of each. */
export type NativeMediaLibrary = Pick<
  Expo,
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'
  | 'presentPermissionsPicker'
  | 'addListener'
  | 'Asset'
  | 'Album'
  | 'Query'
>;

type Args<K extends keyof NativeMediaLibrary> = NativeMediaLibrary[K] extends (
  ...args: infer A
) => unknown
  ? A
  : never;

/**
 * The kinds of asset, as `expo-media-library`'s own enum. Importing the enum from the module
 * loads the module, which a test in Node cannot; these are the same strings, typed as the enum.
 */
export const MediaType = {
  UNKNOWN: 'unknown',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
} as unknown as typeof ExpoMediaType;

/** The fields a query filters and sorts on, as the module's own enum. */
export const AssetField = {
  CREATION_TIME: 'creationTime',
  MODIFICATION_TIME: 'modificationTime',
  MEDIA_TYPE: 'mediaType',
  WIDTH: 'width',
  HEIGHT: 'height',
  DURATION: 'duration',
  IS_FAVORITE: 'isFavorite',
} as unknown as typeof ExpoAssetField;

@Service()
export class MediaLibrary {
  /** Overridden in a test to save photos to a library that is not there. */
  static readonly SOURCE = new InjectionToken<NativeMediaLibrary | null>(
    'angular-native.mediaLibrarySource',
    {
      factory: () => expoModule('expo-media-library', () => require('expo-media-library') as Expo),
    },
  );

  private readonly native = inject(MediaLibrary.SOURCE);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changed = signal<MediaLibraryAssetsChangeEvent | null>(null);
  private readonly changes = this.changed.asReadonly();
  private watching = false;

  /** Full access: reading the library, as well as adding to it. */
  readonly permission: Permission = this.permissionFor(false);

  /** Write-only access, which is all `save()` needs and what it asks for. */
  readonly writePermission: Permission = this.permissionFor(true);

  /**
   * Asks with the module's own options: write-only, and on Android 13 and later which of
   * `'photo'`, `'video'` and `'audio'` to ask for. The answer also updates {@link permission}.
   */
  async requestPermission(...options: Args<'requestPermissionsAsync'>): Promise<boolean> {
    if (!this.native) return false;
    await this.native.requestPermissionsAsync(...options);
    return this.permission.check();
  }

  /**
   * On iOS and Android 14 and later, after the user has granted access to only some photos, shows
   * the system picker for changing which. Does nothing otherwise.
   */
  async presentPermissionsPicker(...mediaTypes: Args<'presentPermissionsPicker'>): Promise<void> {
    await this.native?.presentPermissionsPicker(...mediaTypes);
  }

  /**
   * Saves a local image or video file to the library, into an album if one is given. Asks for
   * write-only access first; null if it is refused.
   */
  async save(uri: string, album?: Album): Promise<Asset | null> {
    if (!this.native || !(await this.writePermission.ensure())) return null;
    return this.native.Asset.create(uri, album);
  }

  /**
   * The assets a query finds, built on the module's own `Query`: `eq`, `within`, `gt`, `lt`,
   * `orderBy`, `limit`, `offset` and `album`. Every asset without one.
   */
  async assets(build: (query: Query) => Query = (query) => query): Promise<Asset[]> {
    if (!this.native) return [];
    return build(new this.native.Query()).exe();
  }

  /** The same query, answered with each asset's details at once rather than as handles. */
  async metadata(build: (query: Query) => Query = (query) => query): Promise<AssetMetadata[]> {
    if (!this.native) return [];
    return build(new this.native.Query()).exeForMetadata();
  }

  /** The handle for an asset whose id is already known, such as one kept from an earlier query. */
  asset(id: string): Asset | null {
    return this.native ? new this.native.Asset(id) : null;
  }

  async deleteAssets(assets: Asset[]): Promise<void> {
    await this.native?.Asset.delete(assets);
  }

  async albums(): Promise<Album[]> {
    return (await this.native?.Album.getAll()) ?? [];
  }

  /** The album with this title, or null. */
  async album(title: string): Promise<Album | null> {
    return (await this.native?.Album.get(title)) ?? null;
  }

  /** A new album holding the assets given, copied into it unless `move` is true. */
  async createAlbum(
    name: string,
    assets: Asset[] | string[],
    move?: boolean,
  ): Promise<Album | null> {
    return (await this.native?.Album.create(name, assets, move)) ?? null;
  }

  /** Deletes the albums, and with `deleteAssets` the assets in them too. */
  async deleteAlbums(albums: Album[], deleteAssets?: boolean): Promise<void> {
    await this.native?.Album.delete(albums, deleteAssets);
  }

  /**
   * The library's most recent change, from the first call on: on iOS the assets inserted, deleted
   * and updated, on Android an empty event. Call it once access is granted, since listening reads
   * the library. The listener is removed when the app is destroyed.
   */
  watch(): Signal<MediaLibraryAssetsChangeEvent | null> {
    if (this.native && !this.watching) {
      this.watching = true;
      const subscription = this.native.addListener((event) => this.changed.set(event));
      this.destroyRef.onDestroy(() => subscription.remove());
    }
    return this.changes;
  }

  private permissionFor(writeOnly: boolean): Permission {
    return Permission.of(
      () => this.native?.getPermissionsAsync(writeOnly) ?? Promise.resolve(UNAVAILABLE),
      () => this.native?.requestPermissionsAsync(writeOnly) ?? Promise.resolve(UNAVAILABLE),
    );
  }
}
