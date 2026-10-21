import { provideNativeRouter } from '@ng-native/router';
import { provideWebCompat } from '@ng-native/web-compat';
import { routes } from './app.routes.ts';
import { cdkOnAPhone } from './cdk-platform.ts';

export const appConfig = {
  providers: [
    // Angular Material reaches for the DOM on what it renders: web-compat gives the engine's
    // nodes those members, so its components render as native views.
    provideWebCompat(),
    cdkOnAPhone,
    provideNativeRouter(routes),
  ],
};
