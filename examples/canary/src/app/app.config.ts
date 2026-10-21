import { withComponentInputBinding } from '@angular/router';
import { provideKeyboardController } from '@ng-native/components';
import { provideNativeKeyboard } from '@ng-native/expo/keyboard';
import {
  provideNativeRouter,
  withHeaderDefaults,
  withLinkParent,
  withTabDefaults,
} from '@ng-native/router';
import { projectLinkParent } from './projects/project-links.ts';
import { routes } from './app.routes.ts';
import { palette } from './palette.ts';

export const appConfig = {
  providers: [
    // react-native-keyboard-controller is installed: the chat's composer follows the keyboard on
    // the native side, a drag through the transcript included.
    provideKeyboardController(),
    // And on Android, @ng-native/expo's own view of the keyboard's motion: the composer follows
    // the keyboard there too, and a keyboard-avoiding-view moves with it rather than jumping.
    provideNativeKeyboard(),
    // `withComponentInputBinding` is what binds a route param to a component input, as on the
    // web: without it both outlets leave a page's inputs alone.
    // The bars are props, so they take the palette from palette.ts and follow the scheme the
    // way the pages' custom properties do. A header that binds its own colours still wins.
    provideNativeRouter(
      routes,
      withComponentInputBinding(),
      // A deep link into the task manager opens on every screen it sits under.
      withLinkParent(projectLinkParent),
      withHeaderDefaults((scheme) => ({
        backgroundColor: palette[scheme].screen,
        titleColor: palette[scheme].textStrong,
        largeTitleColor: palette[scheme].textStrong,
        color: palette[scheme].accent,
      })),
      withTabDefaults((scheme) => ({
        tintColor: palette[scheme].accent,
        backgroundColor: palette[scheme].screen,
      })),
    ),
  ],
};
