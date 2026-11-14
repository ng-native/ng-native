/**
 * expo-media-library over the desktop host's `NgNativeMediaLibrary`, for `MediaLibrary` on macOS,
 * where the library is PhotoKit's. A TurboModule cannot hand back expo-media-library's `Asset`,
 * `Album` and `Query` classes, so these stand in for them over ids: a query is sent as a plain
 * description, an asset's details are read when a getter asks, and the library's changes arrive
 * as `ngNativeMediaLibrary` events once something listens.
 */
import { desktopHost } from './desktop-host.ts';
import type { NativeMediaLibrary } from './media-library.ts';

/** The asset's details as the host answers them: expo's, and where it is and whether it is downloaded. */
type AssetInfo = import('expo-media-library').AssetInfo & {
  location: import('expo-media-library').Location | null;
  isInCloud: boolean;
};
type AlbumMetadata = { id: string; title: string; type: string };

interface MediaHost {
  getPermissionsAsync(writeOnly: boolean): Promise<never>;
  requestPermissionsAsync(writeOnly: boolean): Promise<never>;
  presentPermissionsPicker(): Promise<void>;
  query(query: QueryDescription): Promise<string[]>;
  queryMetadata(query: QueryDescription): Promise<never[]>;
  asset(id: string): Promise<AssetInfo | null>;
  uri(id: string): Promise<string | null>;
  albums(): Promise<AlbumMetadata[]>;
  albumAssets(id: string): Promise<string[]>;
  createAsset(uri: string, album: string | null): Promise<string>;
  deleteAssets(ids: string[]): Promise<void>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  createAlbum(name: string, ids: string[], move: boolean): Promise<AlbumMetadata>;
  deleteAlbums(ids: string[], deleteAssets: boolean): Promise<void>;
  addAssets(album: string, ids: string[]): Promise<void>;
  removeAssets(album: string, ids: string[]): Promise<void>;
  startObserving(): boolean;
}

interface QueryDescription {
  filters: { field: string; op: string; value: unknown }[];
  sort: { key: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
  album?: string;
}

/** An asset, or its id, as the module's methods take either. */
const idOf = (asset: { id: string } | string): string =>
  typeof asset === 'string' ? asset : asset.id;

/** expo-media-library's slice that `MediaLibrary` uses, or null with no NgNativeMediaLibrary. */
export function desktopMediaLibrary(): NativeMediaLibrary | null {
  const host = desktopHost<MediaHost>('NgNativeMediaLibrary');
  if (!host) return null;
  const native = host.module;

  /** The asset's details, read once per getter, as the module's own getters each read. */
  async function info(id: string): Promise<AssetInfo> {
    const found = await native.asset(id);
    if (!found) throw new Error(`MediaLibrary: there is no asset ${id}, or no access to it`);
    return found;
  }

  class Asset {
    readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
    static async create(filePath: string, album?: Album): Promise<Asset> {
      return new Asset(await native.createAsset(filePath, album?.id ?? null));
    }
    static delete(assets: Asset[]): Promise<void> {
      return native.deleteAssets(assets.map(idOf));
    }
    getInfo = (): Promise<AssetInfo> => info(this.id);
    getFilename = async () => (await info(this.id)).filename;
    getMediaType = async () => (await info(this.id)).mediaType;
    getWidth = async () => (await info(this.id)).width;
    getHeight = async () => (await info(this.id)).height;
    getShape = async () => {
      const { width, height } = await info(this.id);
      return { width, height };
    };
    getDuration = async () => (await info(this.id)).duration;
    getCreationTime = async () => (await info(this.id)).creationTime;
    getModificationTime = async () => (await info(this.id)).modificationTime;
    getFavorite = async () => (await info(this.id)).isFavorite ?? false;
    getMediaSubtypes = async () => (await info(this.id)).mediaSubtypes ?? [];
    getLocation = async () => (await info(this.id)).location ?? null;
    getIsInCloud = async () => Boolean((await info(this.id)).isInCloud);
    getOrientation = async () => null;
    getLivePhotoVideoUri = async () => null;
    getUri = async () => {
      const uri = await native.uri(this.id);
      if (uri === null) throw new Error(`MediaLibrary: asset ${this.id} has no file to read`);
      return uri;
    };
    setFavorite = (favorite: boolean) => native.setFavorite(this.id, favorite);
    delete = () => native.deleteAssets([this.id]);
  }

  class Album {
    readonly id: string;
    readonly #metadata: AlbumMetadata | undefined;
    constructor(id: string, metadata?: AlbumMetadata) {
      this.id = id;
      this.#metadata = metadata;
    }
    static async getAll(): Promise<Album[]> {
      return (await native.albums()).map((album) => new Album(album.id, album));
    }
    static async get(title: string): Promise<Album | null> {
      const found = (await native.albums()).find((album) => album.title === title);
      return found ? new Album(found.id, found) : null;
    }
    static async create(
      name: string,
      assets: (Asset | string)[],
      moveAssets = false,
    ): Promise<Album> {
      const album = await native.createAlbum(name, assets.map(idOf), moveAssets);
      return new Album(album.id, album);
    }
    static delete(albums: Album[], deleteAssets = false): Promise<void> {
      return native.deleteAlbums(albums.map(idOf), deleteAssets);
    }
    async #read(): Promise<AlbumMetadata> {
      const found = this.#metadata ?? (await native.albums()).find((album) => album.id === this.id);
      if (!found) throw new Error(`MediaLibrary: there is no album ${this.id}, or no access to it`);
      return found;
    }
    getTitle = async () => (await this.#read()).title;
    getType = async () => (await this.#read()).type;
    getAssets = async () => (await native.albumAssets(this.id)).map((id) => new Asset(id));
    getAssetCount = async () => (await native.albumAssets(this.id)).length;
    add = (assets: Asset | Asset[]) => native.addAssets(this.id, [assets].flat().map(idOf));
    removeAssets = (assets: Asset[]) => native.removeAssets(this.id, assets.map(idOf));
    delete = () => native.deleteAlbums([this.id], false);
  }

  class Query {
    readonly #query: QueryDescription = { filters: [], sort: [] };
    #filter(field: string, op: string, value: unknown): this {
      this.#query.filters.push({ field, op, value });
      return this;
    }
    eq = (field: string, value: unknown) => this.#filter(field, 'eq', value);
    within = (field: string, values: unknown[]) => this.#filter(field, 'within', values);
    gt = (field: string, value: number) => this.#filter(field, 'gt', value);
    gte = (field: string, value: number) => this.#filter(field, 'gte', value);
    lt = (field: string, value: number) => this.#filter(field, 'lt', value);
    lte = (field: string, value: number) => this.#filter(field, 'lte', value);
    contains = (field: string, value: unknown) => this.#filter(field, 'contains', value);
    orderBy = (sort: string | { key: string; ascending?: boolean }) => {
      const { key, ascending = true } = typeof sort === 'string' ? { key: sort } : sort;
      this.#query.sort.push({ key, ascending });
      return this;
    };
    limit = (limit: number) => ((this.#query.limit = limit), this);
    offset = (offset: number) => ((this.#query.offset = offset), this);
    album = (album: Album) => ((this.#query.album = album.id), this);
    exe = async () => (await native.query(this.#query)).map((id) => new Asset(id));
    exeForMetadata = () => native.queryMetadata(this.#query);
  }

  const library = {
    getPermissionsAsync: (writeOnly = false) => native.getPermissionsAsync(writeOnly),
    requestPermissionsAsync: (writeOnly = false) => native.requestPermissionsAsync(writeOnly),
    presentPermissionsPicker: () => native.presentPermissionsPicker(),
    addListener: (listener: (event: never) => void) => {
      native.startObserving();
      return host.listen('ngNativeMediaLibrary', listener as (body: unknown) => void);
    },
    Asset,
    Album,
    Query,
  };
  return library as unknown as NativeMediaLibrary;
}
