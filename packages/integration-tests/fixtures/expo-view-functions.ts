import { type AfterViewInit, Component, viewChild } from '@angular/core';
import { ExpoLivePhoto, ExpoVideo } from '@ng-native/expo';

@Component({
  selector: 'expo-view-functions-fixture',
  imports: [ExpoLivePhoto, ExpoVideo],
  template: `<expo-video /><expo-live-photo />`,
})
export class ExpoViewFunctionsFixture {
  readonly video = viewChild.required(ExpoVideo);
  readonly livePhoto = viewChild.required(ExpoLivePhoto);
}

/** Calls a view function from `ngAfterViewInit`, before the view's first commit. */
@Component({
  selector: 'expo-view-functions-early-fixture',
  imports: [ExpoVideo],
  template: `<expo-video />`,
})
export class ExpoViewFunctionsEarlyFixture implements AfterViewInit {
  readonly video = viewChild.required(ExpoVideo);
  called: Promise<void> | null = null;

  ngAfterViewInit(): void {
    this.called = this.video().enterFullscreen();
  }
}
