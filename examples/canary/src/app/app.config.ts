import { withComponentInputBinding } from '@angular/router';
import { provideKeyboardController } from '@ng-native/components';
import {
  provideNativeRouter,
  withHeaderDefaults,
  withLinkParent,
  withTabDefaults,
} from '@ng-native/router';
import { projectLinkParent } from './projects/project-links.ts';
import { provideWebCompat } from '@ng-native/web-compat';
import { routes } from './app.routes.ts';
import { palette } from './palette.ts';

export const appConfig = {
  providers: [
    // For src/app/spartan: a component library written for the browser, rendered as native views.
    provideWebCompat(),
    // react-native-keyboard-controller is installed: the chat's composer follows the keyboard on
    // the native side, a drag through the transcript included.
    provideKeyboardController(),
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
