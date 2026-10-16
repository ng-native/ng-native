/**
 * The shell: a fixed header, a sidebar that is the reading order, and the page.
 *
 * All of it is ordinary Angular over the DOM. The only React Native on this site is inside a
 * `doc-example`, and that is deliberate rather than a limitation - a documentation site whose own
 * chrome went through the same renderer as the components would be unable to say which of the two
 * a bug belonged to.
 */
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  ActivationStart,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideMoon, lucideSun, lucideX } from '@ng-icons/lucide';
import { LINKS } from './landing/content.ts';
import { LandingMark } from './landing/mark.ts';
import { SECTIONS, type NavItem } from './navigation.ts';
import { DocsSearch } from './search.ts';
import { GITHUB_REPO } from './site.ts';
import { DocsTheme } from './theme.ts';

@Component({
  selector: 'app-root',
  imports: [
    DocsSearch,
    LandingMark,
    NgIcon,
    NgTemplateOutlet,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  providers: [provideIcons({ lucideMenu, lucideMoon, lucideSun, lucideX })],
  template: `
    @if (home()) {
      <!-- The landing page brings its own header, main and footer: see landing/landing.ts. -->
      <router-outlet />
    } @else {
      <header
        class="fixed top-0 z-30 w-full border-b border-border-subtle bg-surface/75 backdrop-blur-xl"
      >
        <nav class="mx-auto flex h-16 w-full max-w-[90rem] items-center gap-x-4 px-5 lg:px-8">
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg lg:hidden"
            [attr.aria-expanded]="menuOpen()"
            aria-label="Navigation"
            (click)="toggleMenu()"
          >
            <ng-icon [name]="menuOpen() ? 'lucideX' : 'lucideMenu'" class="text-lg" />
          </button>

          <!-- The landing page's mark and wordmark, so the two halves of the site are one brand. -->
          <a routerLink="/" class="flex items-center gap-2.5" aria-label="Angular Native, home">
            <landing-mark class="size-7" />
            <span class="font-display text-[17px] font-semibold tracking-[-0.02em] text-fg"
              >Angular Native</span
            >
          </a>

          <div class="ml-auto flex items-center gap-x-1">
            <!-- The landing page's links, in its order, without its call to action. -->
            <a
              class="hidden h-8 items-center rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
              [class.!text-fg]="inDocs()"
              [routerLink]="docs"
              >Docs</a
            >
            <a
              class="hidden h-8 items-center rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
              routerLink="/learn"
              routerLinkActive="!text-fg"
              >Learn</a
            >
            <a
              class="hidden h-8 items-center rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
              routerLink="/examples"
              routerLinkActive="!text-fg"
              >Examples</a
            >
            <a
              class="hidden h-8 items-center rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
              [href]="github"
              >GitHub</a
            >
            <a
              class="hidden h-8 items-center gap-1.5 rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg sm:inline-flex"
              routerLink="/sponsor"
              >Sponsor</a
            >
            <docs-search />
            <button
              type="button"
              class="inline-flex size-8 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg"
              [attr.aria-label]="'Switch to ' + (theme.scheme() === 'dark' ? 'light' : 'dark')"
              (click)="theme.toggle()"
            >
              <ng-icon
                [name]="theme.scheme() === 'dark' ? 'lucideSun' : 'lucideMoon'"
                class="text-base"
              />
            </button>
          </div>
        </nav>
      </header>

      @if (layout() === 'workspace') {
        <!-- A lesson is a workspace that fills the window under the header; see learn/lesson-page.ts. -->
        <main class="pt-16"><router-outlet /></main>
      } @else {
        <div class="mx-auto w-full max-w-[90rem] px-5 pt-24 lg:px-8">
          <div class="flex gap-x-10">
            <!--
        Two sidebars in one, and the same list either way: on a wide screen it is a sticky
        column beside the page, and below that a drawer over it. Writing it once means the
        reading order cannot differ between a laptop and a phone.
      -->
            @if (layout() === 'docs') {
              <nav
                class="scrollbar-hover sticky top-24 hidden h-[calc(100dvh-9rem)] w-52 shrink-0 flex-col gap-y-7 overflow-auto overscroll-contain pb-10 lg:flex"
              >
                <ng-container [ngTemplateOutlet]="links" />
              </nav>
            }

            @if (menuOpen()) {
              <div class="fixed inset-0 z-40 lg:hidden">
                <button
                  type="button"
                  class="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  aria-label="Close navigation"
                  (click)="menuOpen.set(false)"
                ></button>
                <nav
                  class="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-auto border-r border-border-subtle bg-surface px-5 py-6"
                >
                  <div class="flex flex-col gap-y-7" (click)="menuOpen.set(false)">
                    <!-- The header hides its links on a phone, so they lead the drawer there. -->
                    <ul class="flex flex-col gap-y-0.5 sm:hidden">
                      <li><a [routerLink]="docs" [class]="drawerLink">Docs</a></li>
                      <li><a routerLink="/learn" [class]="drawerLink">Learn</a></li>
                      <li><a routerLink="/examples" [class]="drawerLink">Examples</a></li>
                      <li><a [href]="github" [class]="drawerLink">GitHub</a></li>
                      <li><a routerLink="/sponsor" [class]="drawerLink">Sponsor</a></li>
                    </ul>
                    <ng-container [ngTemplateOutlet]="links" />
                  </div>
                </nav>
              </div>
            }

            <main class="min-w-0 flex-1 pb-20"><router-outlet /></main>
          </div>

          <footer
            class="mt-8 flex flex-col items-center gap-y-1 border-t border-border-subtle px-5 py-10 text-xs text-fg-tertiary"
          >
            <p>Angular components as native iOS and Android views, built and shipped with Expo.</p>
            <!--
          text-fg-tertiary, inherited from the footer rather than the lighter fg-quaternary this
          used: fg-quaternary's #a1a1aa is a 2.56:1 ratio against the page background, well under
          the 4.5:1 WCAG AA asks of body text, and this line reads at the same size as the one
          above it.
        -->
            <p>
              An alpha. MIT licensed.
              <a class="underline underline-offset-2 hover:text-fg" routerLink="/sponsor"
                >Sponsor its development</a
              >.
            </p>
            <p>
              An independent project, not affiliated with or endorsed by Google, the Angular team or
              Expo. Angular is a trademark of Google LLC.
            </p>
          </footer>
        </div>
      }
    }

    <ng-template #links>
      @for (section of sections; track section.title) {
        <div>
          <h2
            class="mb-2 px-3 text-[11px] font-semibold tracking-[0.08em] text-fg-tertiary uppercase"
          >
            {{ section.title }}
          </h2>
          <ul class="flex flex-col gap-y-0.5">
            @for (item of section.items; track item.path) {
              <li class="relative">
                @if (item.children?.length) {
                  <!--
                    A group's own row carries no active state, because its index page is listed
                    below as "Overview" and that is what marks it. Left as an ordinary
                    routerLinkActive it matched by prefix, so standing on a sub-page lit up the
                    parent as well as the child, and standing on the index put the marker above
                    the indented list rather than in it.
                  -->
                  <a
                    [routerLink]="'/' + item.path"
                    class="flex h-8 items-center rounded-md px-3 text-sm transition-colors hover:bg-surface-raised hover:text-fg"
                    [class]="isOpen(item) ? 'font-medium text-fg' : 'text-fg-secondary'"
                  >
                    {{ item.title }}
                  </a>
                } @else {
                  <a
                    [routerLink]="'/' + item.path"
                    routerLinkActive="bg-surface-raised !font-medium !text-fg before:absolute before:top-1/2 before:left-0 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-brand"
                    class="flex h-8 items-center rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg"
                  >
                    {{ item.title }}
                  </a>
                }

                <!--
                  Only the open group's pages, so the sidebar stays a list of packages until you
                  are inside one. Showing every page at once would bury the names someone is
                  actually scanning for.
                -->
                @if (item.children?.length && isOpen(item)) {
                  <ul
                    class="mt-0.5 mb-1 ml-3 flex flex-col gap-y-0.5 border-l border-border-subtle pl-2"
                  >
                    @for (child of pages(item); track child.path) {
                      <!--
                        A group's label sits out on the rail, in full ink, with room above it: set
                        in the links' own grey and indent it read as one more link.
                      -->
                      @if (child.group) {
                        <li
                          aria-hidden="true"
                          class="relative -ml-[9px] mt-4 mb-1 flex items-center gap-2 bg-surface py-0.5 pr-2 text-[10.5px] font-semibold tracking-[0.1em] text-fg uppercase select-none first:mt-2"
                        >
                          <span class="h-px w-2 bg-border"></span>
                          {{ child.group }}
                        </li>
                      }
                      <li class="relative">
                        <a
                          [routerLink]="'/' + child.path"
                          [routerLinkActiveOptions]="{ exact: true }"
                          routerLinkActive="!text-fg !font-medium before:absolute before:top-1/2 before:-left-[9px] before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-brand"
                          class="flex h-7 items-center rounded-md px-3 text-[13px] text-fg-tertiary transition-colors hover:text-fg"
                        >
                          {{ child.title }}
                        </a>
                      </li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        </div>
      }
    </ng-template>
  `,
  host: { '(click)': 'followLink($event)' },
})
export class App {
  private readonly router = inject(Router);

  protected readonly theme = inject(DocsTheme);
  protected readonly sections = SECTIONS;
  protected readonly github = GITHUB_REPO;
  protected readonly docs = LINKS.docs;
  protected readonly drawerLink =
    'flex h-9 items-center rounded-md px-3 text-[15px] font-medium text-fg transition-colors hover:bg-surface-raised';
  /** Every guide and package page is the docs, whichever one the Docs link happens to open. */
  protected readonly inDocs = computed(() => /^\/(guide|packages)(\/|$)/.test(this.url()));

  /**
   * Whether a group's pages are showing: the one the reader is inside, and no other.
   *
   * Read from the URL rather than held in a signal a click toggles, so arriving at a sub-page from
   * a link or a reload opens the right group without anything having to remember. Through the
   * `url` signal rather than `router.url`, or the sidebar would not redraw when navigation
   * changed which group is open.
   */
  /**
   * A group's pages, with its own index page first.
   *
   * Without the index in the list there is nothing to mark when you are standing on it, and the
   * group's own row is the wrong thing to mark: it sits above the indented list, so the marker
   * reads as belonging to the section rather than to a page in it.
   */
  protected pages(item: NavItem): NavItem[] {
    if (item.children?.some((child) => child.path === item.path)) {
      return [...item.children];
    }
    return [{ path: item.path, title: 'Overview' }, ...(item.children ?? [])];
  }

  protected isOpen(item: NavItem): boolean {
    const current = this.url().split('?')[0] ?? '';
    return (
      current === `/${item.path}` ||
      current.startsWith(`/${item.path}/`) ||
      (item.children?.some((child) => current === `/${child.path}`) ?? false)
    );
  }
  protected readonly menuOpen = signal(false);

  /**
   * What `isOpen` reads. Through this signal rather than `router.url`, or the sidebar would not
   * redraw when navigation changed which group is open.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Whether the landing page is showing, which renders without the documentation's chrome.
   *
   * Decided at `ActivationStart`, before the outlet activates the next page, so a page is never
   * created inside the shell it is about to leave. The first value comes from the address bar:
   * before the initial navigation `router.url` is `/` whatever was asked for, and a docs page
   * would otherwise flash the landing page's empty shell.
   */
  protected readonly home = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof ActivationStart),
      map((event) => event.snapshot.routeConfig?.path === ''),
    ),
    { initialValue: location.pathname === '/' },
  );

  /**
   * Which shell a page sits in: the documentation's, with the sidebar; the course's, without it;
   * or a lesson's, which is a workspace filling the window under the header with no footer.
   * Decided at `ActivationStart` for the same reason as `home`, and first from the address bar.
   */
  protected readonly layout = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof ActivationStart),
      map((event) => layoutFor(event.snapshot.routeConfig?.path ?? '')),
    ),
    {
      initialValue: layoutFor(
        location.pathname.replace(/^\/+|\/+$/g, '').replace(/^(learn|examples)\/.+/, '$1/:slug'),
      ),
    },
  );

  /**
   * Prose, API tables and example pages arrive as prerendered HTML, so their links are plain
   * anchors rather than router links. Without this, following one reloads the whole site.
   */
  protected followLink(event: MouseEvent): void {
    const url = routableLink(event);
    if (!url) return;
    event.preventDefault();
    void this.router.navigateByUrl(url.pathname + url.search + url.hash);
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }
}

type Layout = 'docs' | 'course' | 'workspace';

/** The course's index and the example apps are pages of their own, without the sidebar. */
const WITHOUT_SIDEBAR = new Set(['learn', 'examples', 'examples/:slug']);

function layoutFor(routePath: string): Layout {
  if (routePath === 'learn/:slug') return 'workspace';
  return WITHOUT_SIDEBAR.has(routePath) ? 'course' : 'docs';
}

/** A left click with no modifier key: one the router may take over. */
function plainClick(event: MouseEvent): boolean {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  return !event.defaultPrevented && event.button === 0 && !modified;
}

/** The same-site page a plain left click on a link is heading for, or `null` to leave it be. */
function routableLink(event: MouseEvent): URL | null {
  if (!plainClick(event)) return null;
  const link = (event.target as Element | null)?.closest?.('a[href]');
  if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) {
    return null;
  }
  const url = new URL(link.href);
  // A file the site serves as it is (llms.txt, a page's markdown copy) is not a route.
  if (url.origin !== location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return null;
  return url;
}
