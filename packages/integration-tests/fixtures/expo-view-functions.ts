import { Component, viewChild } from '@angular/core';
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
