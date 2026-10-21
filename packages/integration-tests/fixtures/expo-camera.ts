import { type AfterViewInit, Component, viewChild } from '@angular/core';
import { Camera } from '@ng-native/expo/camera';

@Component({
  selector: 'expo-camera-fixture',
  imports: [Camera],
  template: `<expo-camera facing="back" />`,
})
export class ExpoCameraFixture {
  readonly camera = viewChild.required(Camera);
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
