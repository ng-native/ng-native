import { type AfterViewInit, Component, signal, viewChild } from '@angular/core';
import { Camera } from '@ng-native/expo/camera';

@Component({
  selector: 'expo-camera-fixture',
  imports: [Camera],
  template: `<expo-camera facing="back" />`,
})
export class ExpoCameraFixture {
  readonly camera = viewChild.required(Camera);
}

/** `mute` bound, and written as a bare attribute. */
@Component({
  selector: 'expo-camera-mute-fixture',
  imports: [Camera],
  template: `<expo-camera mode="video" [mute]="muted()" /><expo-camera mute />`,
})
export class ExpoCameraMuteFixture {
  readonly muted = signal<boolean | null | undefined>(undefined);
}

/** Records and stops from `ngAfterViewInit`, before the view's first commit. */
@Component({
  selector: 'expo-camera-early-fixture',
  imports: [Camera],
  template: `<expo-camera mode="video" />`,
})
export class ExpoCameraEarlyFixture implements AfterViewInit {
  readonly camera = viewChild.required(Camera);
  recorded: Promise<unknown> | null = null;
  stopped: Promise<void> | null = null;

  ngAfterViewInit(): void {
    this.recorded = this.camera().record();
    this.stopped = this.camera().stopRecording();
  }
}

/** Scanning by listener: bound, unbound, bound but switched off, and subscribed from code. */
@Component({
  selector: 'expo-camera-scan-fixture',
  imports: [Camera],
  template: `
    <expo-camera (barcodeScanned)="scanned = $event" />
    <expo-camera />
    <expo-camera [barcodeScannerEnabled]="false" (barcodeScanned)="scanned = $event" />
    <expo-camera #code />
  `,
})
export class ExpoCameraScanFixture {
  readonly code = viewChild.required('code', { read: Camera });
  scanned: unknown = null;
}
