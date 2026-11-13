import { provideNativeRouter } from '@ng-native/router';
import { provideWebCompat } from '@ng-native/web-compat';
import { provideEventPlugins } from '@ng-native/web-compat/event-plugins';
import { provideTaiga } from '@taiga-ui/core/utils/miscellaneous';
import { routes } from './app.routes.ts';

export const appConfig = {
  providers: [
    // Taiga UI reaches for the DOM on what it renders: web-compat gives the engine's nodes those
    // members, so its components render as native views.
    provideWebCompat(),
    // Taiga listens by names its event plugins read, such as its tabs' `tui-tab-activate.stop`.
    provideEventPlugins(),
    provideTaiga(),
    provideNativeRouter(routes),
  ],
};
