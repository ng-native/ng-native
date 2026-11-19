import { Component, signal } from '@angular/core';
import { Camera } from '../../expo/src/camera.ts';
import { ExpoBlur } from '../../expo/src/expo-blur.ts';
import { ExpoGL } from '../../expo/src/expo-gl.ts';
import { ExpoLivePhoto } from '../../expo/src/expo-live-photo.ts';
import { ExpoMeshGradient } from '../../expo/src/expo-mesh-gradient.ts';
import { ExpoVideo } from '../../expo/src/expo-video.ts';
import { MapView } from '../../expo/src/map-view.ts';

/**
 * Each typed Expo view with its props written as an app writes them: static attributes, a bare
 * boolean attribute, and bindings a test changes. A `-plain` view of each has nothing set.
 */
@Component({
  selector: 'x-expo-view-props',
  imports: [Camera, ExpoBlur, ExpoGL, ExpoLivePhoto, ExpoMeshGradient, ExpoVideo, MapView],
  template: `
    <expo-video
      nativeID="video"
      [player]="player()"
      contentFit="cover"
      requiresLinearPlayback
      [nativeControls]="on()"
      [fullscreenOptions]="{ enable: true }"
    />
    <expo-video nativeID="video-plain" />
    <expo-blur
      nativeID="blur"
      tint="dark"
      intensity="80"
      blurMethod="dimezisBlurViewSdk31Plus"
      blurReductionFactor="2"
    />
    <expo-blur nativeID="blur-plain" />
    <expo-gl nativeID="gl" msaaSamples="0" enableExperimentalWorkletSupport />
    <expo-gl nativeID="gl-plain" [enableExperimentalWorkletSupport]="on()" />
    <expo-mesh-gradient
      nativeID="mesh"
      columns="2"
      rows="1"
      [points]="[
        [0, 0],
        [1, 0],
      ]"
      [colors]="['red', '#00ff00']"
      mask
      [smoothsColors]="on()"
    />
    <expo-mesh-gradient nativeID="mesh-plain" />
    <expo-live-photo
      nativeID="live"
      [source]="{ photoUri: 'file:///p.heic', pairedVideoUri: 'file:///p.mov' }"
      isMuted
      contentFit="cover"
      [useDefaultGestureRecognizer]="on()"
    />
    <expo-live-photo nativeID="live-plain" />
    <expo-camera
      nativeID="camera"
      facing="front"
      flash="on"
      flashMode="off"
      autofocus="on"
      autoFocus="off"
      zoom="0.5"
      mode="video"
      videoQuality="720p"
      videoBitrate="1000000"
      enableTorch
      mirror
      [active]="on()"
      [barcodeScannerSettings]="{ barcodeTypes: ['qr'] }"
    />
    <expo-camera nativeID="camera-plain" />
    <expo-camera nativeID="camera-native-names" flashMode="on" autoFocus="on" />
    <expo-maps-apple nativeID="apple-map" colorScheme="DARK" [markers]="[{ id: 'a' }]" />
    <expo-maps-google
      nativeID="google-map"
      [circles]="[{ center, radius: 5, color: 'red', lineColor: processed }]"
      [polylines]="[{ coordinates: [center], color: processed }]"
    />
  `,
})
export class ExpoViewPropsFixture {
  readonly player = signal<number | { readonly id: number | undefined } | null>({ id: 7 });
  readonly on = signal<boolean | null | undefined>(false);
  readonly center = { latitude: 51.5, longitude: -0.1 };
  /** A colour `processColor` has already converted, as expo-maps' own types allow. */
  readonly processed = 0xff00ff00;
}
