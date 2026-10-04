import { withComponentInputBinding } from '@angular/router';
import { provideNativeRouter, withLinkParent } from '@ng-native/router';
import { routes } from './app.routes.ts';

/** A link that launches the app on a note or a screen opens with the library beneath it. */
export const appConfig = {
  providers: [
    provideNativeRouter(
      routes,
      withComponentInputBinding(),
      withLinkParent((url) => (url === '/' ? null : '/')),
    ),
  ],
};
