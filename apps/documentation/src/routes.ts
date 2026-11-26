/**
 * The home page, and everything else.
 *
 * The wildcard is not a fallback here, it is the main route: every guide page and package page is
 * a markdown file resolved from the URL by `doc-page`, so they need no entry of their own. The
 * home page is the one page that is not a document.
 *
 * Lazy, so that a reader who opened one page has downloaded one page.
 */
import type { ResolveFn, Route, Routes } from '@angular/router';
import { BLOG_POSTS, loadPost } from './blog/posts.ts';
import { loadDoc, type DocModule } from './content.ts';

/** The markdown page for the URL, or `null` when there is none: see `doc-page`'s `doc` input. */
const doc: ResolveFn<DocModule | null> = (route) => {
  const load = loadDoc(route.url.map((segment) => segment.path).join('/'));
  return load ? load().catch(() => null) : null;
};

const pages: Routes = [
  { path: '', loadComponent: () => import('./landing/landing.ts').then((m) => m.Home) },
  // The course. Its lesson page is a workspace rather than a document, so the shell drops the
  // sidebar and footer for everything under `learn`; see `app.ts`.
  {
    path: 'learn',
    loadComponent: () => import('./learn/course-page.ts').then((m) => m.CoursePage),
  },
  {
    path: 'learn/:slug',
    loadComponent: () => import('./learn/lesson-page.ts').then((m) => m.LessonPage),
  },
  // The example apps: a gallery, and a page for each with its code. See `example-apps/registry.ts`.
  {
    path: 'examples',
    loadComponent: () => import('./example-apps/gallery-page.ts').then((m) => m.ExampleGalleryPage),
  },
  {
    path: 'examples/:slug',
    loadComponent: () => import('./example-apps/example-app-page.ts').then((m) => m.ExampleAppPage),
  },
  // The blog, which wears the landing page's header and footer rather than the docs' chrome; see
  // `app.ts`. One route per post, from `blog/posts.ts`, with its prose loaded before it shows.
  { path: 'blog', loadComponent: () => import('./blog/blog-page.ts').then((m) => m.BlogPage) },
  ...BLOG_POSTS.map((post) => ({
    path: `blog/${post.slug}`,
    loadComponent: () => import('./blog/blog-article.ts').then((m) => m.BlogArticle),
    data: { slug: post.slug },
    resolve: { prose: () => loadPost(post.slug) },
  })),
  {
    path: '**',
    loadComponent: () => import('./doc-page.ts').then((m) => m.DocPage),
    resolve: { doc },
  },
];

/** Where `loadedByResolveEnd` keeps the component it loads, apart from any data a page reads. */
const COMPONENT = Symbol('component');

export const routes: Routes = pages.map(loadedByResolveEnd);

/**
 * The route with its lazy component loaded by a resolver too. The router loads a lazy component
 * only after `ResolveEnd`, which is where `app.ts` switches the shell, so a page whose code was
 * still loading would leave the previous page on screen inside the next page's shell.
 */
function loadedByResolveEnd(route: Route): Route {
  const load = route.loadComponent;
  if (!load) return route;
  return { ...route, resolve: { ...route.resolve, [COMPONENT]: () => load() } };
}
