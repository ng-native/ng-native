import type { Routes } from '@angular/router';
import { signedIn } from './auth/session.ts';

/**
 * Every feature on its own screen, behind `loadComponent`, which is what a real app does and what
 * this app exists to exercise.
 *
 * Worth knowing what that costs while developing, because it is easy to mistake for a slow app:
 * Metro serves every `import()` as its own bundle, built and fetched when the route is first
 * activated. That is a few hundred milliseconds of bundling plus an HTTP round-trip - over wifi
 * on a real phone - the first time each screen is opened, and nothing on later visits. A
 * production export is a single bundle regardless; Metro inlines async imports when it is not
 * serving them itself.
 */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.ts').then((m) => m.Home) },
  { path: 'feed', loadComponent: () => import('./feed/feed.ts').then((m) => m.FeedPage) },
  { path: 'chat', loadComponent: () => import('./chat/chat.ts').then((m) => m.ChatPage) },
  { path: 'world', loadComponent: () => import('./world/world-page.ts').then((m) => m.WorldPage) },
  { path: 'notes', loadComponent: () => import('./notes/notes-page.ts').then((m) => m.NotesPage) },
  {
    path: 'notes/:id',
    loadComponent: () => import('./notes/note-editor.ts').then((m) => m.NoteEditor),
  },
  {
    path: 'stories',
    loadComponent: () => import('./stories/stories-page.ts').then((m) => m.StoriesPage),
  },
  {
    path: 'stories/view',
    loadComponent: () => import('./stories/story-viewer.ts').then((m) => m.StoryViewer),
  },
  { path: 'shop', loadComponent: () => import('./shop/shop-page.ts').then((m) => m.ShopPage) },
  {
    path: 'shop/basket',
    loadComponent: () => import('./shop/basket-sheet.ts').then((m) => m.BasketSheet),
  },
  {
    path: 'shop/:id',
    loadComponent: () => import('./shop/product-page.ts').then((m) => m.ProductPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings-page.ts').then((m) => m.SettingsPage),
  },
  {
    path: 'settings/:section',
    loadComponent: () => import('./settings/settings-detail.ts').then((m) => m.SettingsDetail),
  },
  {
    path: 'wallet',
    loadComponent: () => import('./wallet/wallet-page.ts').then((m) => m.WalletPage),
  },
  {
    path: 'calendar',
    loadComponent: () => import('./calendar/calendar-page.ts').then((m) => m.CalendarPage),
  },
  {
    path: 'kanban',
    loadComponent: () => import('./kanban/kanban-page.ts').then((m) => m.KanbanPage),
  },
  { path: 'ride', loadComponent: () => import('./ride/ride-page.ts').then((m) => m.RidePage) },
  {
    path: 'player',
    loadComponent: () => import('./player/player-page.ts').then((m) => m.PlayerPage),
  },
  {
    path: 'player/now',
    loadComponent: () => import('./player/now-playing.ts').then((m) => m.NowPlaying),
  },
  {
    path: 'ride/where',
    loadComponent: () => import('./ride/ride-sheet.ts').then((m) => m.RideSheet),
  },
  {
    path: 'browse',
    loadComponent: () => import('./browse/browse.ts').then((m) => m.Browse),
  },
  {
    path: 'inbox',
    loadComponent: () => import('./inbox/inbox.ts').then((m) => m.InboxPage),
  },
  {
    path: 'orders',
    loadComponent: () => import('./orders/orders-page.ts').then((m) => m.OrdersPage),
  },
  {
    path: 'orders/:id',
    loadComponent: () => import('./orders/order-page.ts').then((m) => m.OrderPage),
  },
  {
    path: 'field-notes',
    loadComponent: () => import('./offline/offline-notes.ts').then((m) => m.OfflineNotes),
  },
  {
    path: 'stress',
    loadComponent: () => import('./stress/stress-list.ts').then((m) => m.StressList),
  },
  {
    path: 'overlays',
    loadComponent: () => import('./overlays/overlays-page.ts').then((m) => m.OverlaysPage),
  },
  {
    path: 'overlays/sheet',
    data: { sheet: true },
    loadComponent: () => import('./overlays/overlays-page.ts').then((m) => m.OverlaysPage),
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./auth/login-page.ts').then((m) => m.LoginPage),
  },
  { path: 'auth/code', loadComponent: () => import('./auth/code-page.ts').then((m) => m.CodePage) },
  {
    path: 'account',
    canActivate: [signedIn],
    loadComponent: () => import('./auth/account-page.ts').then((m) => m.AccountPage),
  },
  {
    path: 'account/settings',
    canActivate: [signedIn],
    data: { settings: true },
    loadComponent: () => import('./auth/account-page.ts').then((m) => m.AccountPage),
  },
  {
    path: 'account/orders',
    canActivate: [signedIn],
    loadComponent: () => import('./orders/orders-page.ts').then((m) => m.OrdersPage),
  },
  { path: 'photos', loadComponent: () => import('./viewer/gallery.ts').then((m) => m.Gallery) },
  {
    path: 'photos/:index',
    loadComponent: () => import('./viewer/photo-viewer.ts').then((m) => m.PhotoViewer),
  },
  {
    path: 'queue',
    loadComponent: () => import('./collections/playlist.ts').then((m) => m.Playlist),
  },
  {
    path: 'search-demo',
    loadComponent: () => import('./search/music-search.ts').then((m) => m.MusicSearch),
  },
  {
    path: 'search-demo/:id',
    loadComponent: () => import('./search/search-result.ts').then((m) => m.SearchResult),
  },
  {
    path: 'projects',
    loadComponent: () => import('./projects/projects-page.ts').then((m) => m.ProjectsPage),
  },
  {
    path: 'projects/:pid',
    loadComponent: () => import('./projects/project-page.ts').then((m) => m.ProjectPage),
  },
  {
    path: 'projects/:pid/new',
    loadComponent: () => import('./projects/task-editor.ts').then((m) => m.TaskEditor),
  },
  {
    path: 'projects/:pid/tasks/:tid',
    loadComponent: () => import('./projects/task-page.ts').then((m) => m.TaskPage),
  },
  {
    path: 'projects/:pid/tasks/:tid/edit',
    loadComponent: () => import('./projects/task-editor.ts').then((m) => m.TaskEditor),
  },
  {
    path: 'projects/:pid/tasks/:tid/comments/:cid',
    loadComponent: () => import('./projects/comment-page.ts').then((m) => m.CommentPage),
  },
  {
    path: 'people/:uid',
    loadComponent: () => import('./projects/person-page.ts').then((m) => m.PersonPage),
  },
  {
    path: 'keyboard',
    loadComponent: () => import('./keyboard/keyboard-lab.ts').then((m) => m.KeyboardLab),
  },
  {
    path: 'keyboard/sheet',
    loadComponent: () => import('./keyboard/note-sheet.ts').then((m) => m.NoteSheet),
  },
  {
    path: 'application',
    loadComponent: () => import('./forms/application.ts').then((m) => m.ApplicationPage),
  },
  {
    path: 'primitives',
    loadComponent: () => import('./components/primitives.ts').then((m) => m.Primitives),
  },
  { path: 'text', loadComponent: () => import('./css/text.ts').then((m) => m.TextNesting) },
  { path: 'css', loadComponent: () => import('./css/css.ts').then((m) => m.CssPage) },
  {
    path: 'spartan',
    loadComponent: () => import('./spartan/spartan-page.ts').then((m) => m.SpartanPage),
  },
  {
    path: 'tailwind',
    loadComponent: () => import('./tailwind/tailwind-page.ts').then((m) => m.TailwindPage),
  },
  { path: 'layout', loadComponent: () => import('./css/layout.ts').then((m) => m.LayoutPage) },
  {
    path: 'typography',
    loadComponent: () => import('./css/typography.ts').then((m) => m.TypographyPage),
  },
  {
    path: 'surfaces',
    loadComponent: () => import('./css/surfaces.ts').then((m) => m.SurfacesPage),
  },
  {
    path: 'scrolling',
    loadComponent: () => import('./lists/scrolling.ts').then((m) => m.ScrollingPage),
  },
  { path: 'verify', loadComponent: () => import('./device/verify.ts').then((m) => m.VerifyPage) },
  {
    path: 'css-engine',
    loadComponent: () => import('./css/css-engine.ts').then((m) => m.CssEnginePage),
  },
  {
    path: 'expo-ui',
    loadComponent: () => import('./expo/expo-ui.ts').then((m) => m.ExpoUiPage),
  },
  {
    path: 'native-views',
    loadComponent: () => import('./expo/native-views.ts').then((m) => m.NativeViewsPage),
  },
  { path: 'forms', loadComponent: () => import('./forms/forms.ts').then((m) => m.FormsPage) },
  {
    path: 'gestures',
    loadComponent: () => import('./gestures/gestures.ts').then((m) => m.Gestures),
  },
  { path: 'list', loadComponent: () => import('./lists/list.ts').then((m) => m.ListPage) },
  {
    path: 'components',
    loadComponent: () => import('./components/components.ts').then((m) => m.ComponentsPage),
  },
  { path: 'modal', loadComponent: () => import('./navigation/modal.ts').then((m) => m.ModalPage) },
  {
    path: 'navigation',
    loadComponent: () => import('./navigation/navigation.ts').then((m) => m.NavigationPage),
  },
  { path: 'detail', loadComponent: () => import('./navigation/detail.ts').then((m) => m.Detail) },
  { path: 'sheet', loadComponent: () => import('./navigation/sheet.ts').then((m) => m.Sheet) },
  { path: 'header', loadComponent: () => import('./navigation/header.ts').then((m) => m.Header) },
  {
    path: 'regressions',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.Regressions),
  },
  {
    path: 'regressions/header',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionHeader),
  },
  {
    path: 'regressions/item/:id',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionItem),
  },
  {
    path: 'regressions/modal',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionModal),
  },
  {
    path: 'regressions/broken',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionBroken),
  },
  {
    path: 'regressions/text',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionText),
  },
  {
    path: 'regressions/rtl',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionRtl),
  },
  {
    path: 'regressions/dates',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionDates),
  },
  {
    path: 'regressions/defer',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionDefer),
  },
  {
    path: 'regressions/hidden-modal',
    loadComponent: () => import('./navigation/regressions.ts').then((m) => m.RegressionHiddenModal),
  },
  {
    path: 'animation',
    loadComponent: () => import('./components/animation.ts').then((m) => m.AnimationPage),
  },
  { path: 'icons', loadComponent: () => import('./components/icons.ts').then((m) => m.IconsPage) },
  { path: 'device', loadComponent: () => import('./device/device.ts').then((m) => m.DevicePage) },
  {
    path: 'native-gestures',
    loadComponent: () => import('./gestures/native-gestures.ts').then((m) => m.NativeGesturesPage),
  },
  {
    path: 'worklets',
    loadComponent: () => import('./gestures/worklets.ts').then((m) => m.WorkletsPage),
  },
  {
    // A tab bar. The bar itself is declared in the page's template; these are the routes its
    // items select. The library tab has a stack of its own, which is what makes pushing inside a
    // tab keep the bar.
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs.ts').then((m) => m.TabsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'library' },
      {
        path: 'library',
        loadComponent: () => import('./tabs/tab-library.ts').then((m) => m.TabLibrary),
        children: [
          {
            path: '',
            loadComponent: () => import('./tabs/tab-library.ts').then((m) => m.LibraryList),
          },
          {
            path: ':album',
            loadComponent: () => import('./tabs/tab-library.ts').then((m) => m.LibraryAlbum),
          },
        ],
      },
      {
        path: 'search',
        loadComponent: () => import('./tabs/tab-plain.ts').then((m) => m.TabSearch),
      },
      {
        path: 'profile',
        loadComponent: () => import('./tabs/tab-plain.ts').then((m) => m.TabProfile),
      },
    ],
  },
  { path: 'expo', loadComponent: () => import('./expo/expo.ts').then((m) => m.ExpoPage) },
  { path: 'maps', loadComponent: () => import('./expo/maps.ts').then((m) => m.MapsPage) },
  {
    path: 'language-model',
    loadComponent: () => import('./expo/language-model.ts').then((m) => m.LanguageModelPage),
  },
  {
    path: 'dom-components',
    loadComponent: () =>
      import('./dom-components/dom-components.ts').then((m) => m.DomComponentsPage),
  },
];
