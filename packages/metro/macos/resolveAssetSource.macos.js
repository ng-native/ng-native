/**
 * React Native's `resolveAssetSource` in a `macos` bundle: its own, which first looks for the asset
 * among the running Expo update's.
 *
 * The desktop host lays an update's assets out where React Native's resolver looks beside the
 * bundle, as the bundle's registrations of them say. A Hermes bytecode bundle's registrations
 * cannot be read, so the host keeps those assets by file hash instead, and
 * `NgNativeUpdates.localAssets` names each by that hash: the file hash of the scale the resolver
 * picks. `expo-asset` does the same with `expo-updates`' `localAssets` on iOS and Android. The map
 * is empty for the embedded bundle and in development, where the resolver answers as it always does.
 */
import resolveAssetSource from 'react-native/Libraries/Image/resolveAssetSource.js';
import * as TurboModuleRegistry from 'react-native/Libraries/TurboModule/TurboModuleRegistry';
import PixelRatio from 'react-native/Libraries/Utilities/PixelRatio';

const localAssets = TurboModuleRegistry.get('NgNativeUpdates')?.localAssets;

if (localAssets && typeof localAssets === 'object' && Object.keys(localAssets).length > 0) {
  resolveAssetSource.addCustomSourceTransformer((resolver) => {
    const { asset } = resolver;
    const scale = resolveAssetSource.pickScale(asset.scales, PixelRatio.get());
    const hash = asset.fileHashes?.[asset.scales.indexOf(scale)];
    const uri = hash ? localAssets[hash] : undefined;
    return typeof uri === 'string' ? resolver.fromSource(uri) : null;
  });
}

export default resolveAssetSource;
