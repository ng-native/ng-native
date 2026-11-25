/**
 * Any page whose content is a markdown file: a guide page or a package page.
 *
 * One component rather than one per section, because a page here is the same shape whatever it is
 * about - an article, a contents column beside it, and a link to the next thing to read. What
 * differs between sections is the content, and that is in the markdown.
 *
 * The document is resolved from the URL rather than declared per route, so adding a page is
 * adding a `.md` file and a line in `navigation.ts`, with nothing to change here.
 */
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown } from '@ng-icons/lucide';
import type { DocBlock } from '../build/markdown.ts';
import type { DocModule } from './content.ts';
import { DocArt } from './doc-art.ts';
import { DocMonitoringCard } from './doc-monitoring-card.ts';
import { DocUsage } from './doc-usage.ts';
import { LINKS } from './landing/content.ts';
import { DocContent } from './doc-content.ts';
import { breadcrumbsFor, READING_ORDER } from './navigation.ts';
import { Seo } from './seo.ts';
import { DEFAULT_DESCRIPTION, SITE_NAME } from './site.ts';

/** The brand belongs in every title, but "Angular Native compared - Angular Native" does not. */
function titleFor(title: string): string {
  return title.startsWith(SITE_NAME) ? title : `${title} - ${SITE_NAME}`;
}

@Component({
  selector: 'doc-page',
  imports: [DocArt, DocContent, DocMonitoringCard, DocUsage, NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronDown })],
  template: `
    @if (doc() === null) {
      <div class="prose max-w-3xl">
        <h1>Not found</h1>
        <p>
          There is no page at <code>/{{ path() }}</code
          >.
        </p>
        <p><a routerLink="/">Back to the overview</a></p>
      </div>
    } @else if (doc(); as page) {
      <div class="flex gap-x-12">
        <!-- The one part of the site the search index reads: see src/search.ts. -->
        <article class="min-w-0 flex-1" data-pagefind-body>
          <div class="max-w-3xl">
            @if (page.headings.length > 1) {
              <!--
                The sticky column below only shows from xl up (see the <aside> at the end of this
                template), so a reader on a phone or a tablet gets this instead: closed by default,
                because a list of headings above the prose it describes is a worse first screen than
                the prose itself. It sits above the title, so it never crowds the lead.
              -->
              <div
                class="mb-8 rounded-lg border border-border-subtle xl:hidden"
                data-pagefind-ignore
              >
                <button
                  type="button"
                  class="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-fg"
                  [attr.aria-expanded]="tocOpen()"
                  (click)="toggleToc()"
                >
                  On this page
                  <ng-icon
                    name="lucideChevronDown"
                    class="text-fg-tertiary transition-transform"
                    [class.rotate-180]="tocOpen()"
                  />
                </button>
                @if (tocOpen()) {
                  <ul
                    class="flex flex-col gap-y-0.5 border-t border-border-subtle px-3 py-2 text-sm"
                  >
                    @for (heading of page.headings; track heading.id) {
                      <li>
                        <a
                          [routerLink]="[]"
                          [fragment]="heading.id"
                          class="block rounded-md py-1 text-fg-tertiary transition-colors hover:text-fg"
                          [class]="heading.level === 3 ? 'pl-6' : 'pl-3'"
                          (click)="tocOpen.set(false)"
                        >
                          {{ heading.text }}
                        </a>
                      </li>
                    }
                  </ul>
                }
              </div>
            }

            @if (page.attributes.art; as art) {
              <doc-art [name]="art" />
            }
            @let parts = split(page.blocks);
            <doc-content [blocks]="parts.lead" />
            @if (parts.references.length) {
              <doc-usage [references]="parts.references" data-pagefind-ignore />
            }
            <!--
              Its own prose block, so the paragraph rhythm does not reach across from the lead:
              without the margin the second paragraph sat flush under the first.
            -->
            <doc-content [blocks]="parts.rest" [class.mt-4]="parts.lead.length > 0" />

            @if (previous() || next()) {
              <!--
                Two fixed halves: Previous always on the left and Next always on the right, so
                either one keeps its place and its size when the other is missing.
              -->
              <nav
                class="mt-16 grid grid-cols-2 gap-4 border-t border-border-subtle pt-6"
                data-pagefind-ignore
              >
                @if (previous(); as item) {
                  <a
                    [routerLink]="'/' + item.path"
                    class="flex flex-col gap-0.5 rounded-lg border border-border-subtle p-4 transition-colors hover:border-border-strong"
                  >
                    <span class="text-xs text-fg-tertiary">Previous</span>
                    <span class="text-sm font-medium text-fg">{{ item.title }}</span>
                  </a>
                }
                @if (next(); as item) {
                  <a
                    [routerLink]="'/' + item.path"
                    class="col-start-2 flex flex-col items-end gap-0.5 rounded-lg border border-border-subtle p-4 text-right transition-colors hover:border-border-strong"
                  >
                    <span class="text-xs text-fg-tertiary">Next</span>
                    <span class="text-sm font-medium text-fg">{{ item.title }}</span>
                  </a>
                }
              </nav>
            }
          </div>
        </article>

        <!--
          The contents column, from xl up: the page's headings, then the Monitoring card, which
          stands in for the column on a page with no headings to list.
        -->
        <aside
          class="scrollbar-hover sticky top-24 hidden h-fit max-h-[calc(100dvh-9rem)] w-56 shrink-0 overflow-auto pb-2 xl:block"
          data-pagefind-ignore
        >
          @if (page.headings.length > 1) {
            <nav aria-label="On this page">
              <h2
                class="mb-2 px-3 text-[11px] font-semibold tracking-[0.08em] text-fg-tertiary uppercase"
              >
                On this page
              </h2>
              <ul class="flex flex-col gap-y-0.5 text-sm">
                @for (heading of page.headings; track heading.id) {
                  <li>
                    <a
                      [routerLink]="[]"
                      [fragment]="heading.id"
                      class="block rounded-md py-1 text-fg-tertiary transition-colors hover:text-fg"
                      [class]="heading.level === 3 ? 'pl-6' : 'pl-3'"
                    >
                      {{ heading.text }}
                    </a>
                  </li>
                }
              </ul>
            </nav>
          }
          @if (path() !== monitoringPage) {
            <doc-monitoring-card [page]="path()" [class.mt-8]="page.headings.length > 1" />
          }
        </aside>
      </div>
    }
  `,
})
export class DocPage {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(Seo);

  /**
   * The path, from the route's own segments rather than from `Router.url`.
   *
   * Angular reuses this component when one markdown page navigates to another, since both match
   * the same route. `Router.url` read once in a field would then be the path of whichever page
   * happened to be first. The segments are an observable for exactly this case.
   */
  protected readonly path = toSignal(
    this.route.url.pipe(map((segments) => segments.map((segment) => segment.path).join('/'))),
    { initialValue: '' },
  );

  /**
   * The document, loaded by the route's resolver before the router switches to it, so the page
   * being left stays on screen until the next one is ready. `null` when there is no such page.
   */
  readonly doc = input<DocModule | null>();

  /** The Monitoring guide, which needs no card pointing to itself. */
  protected readonly monitoringPage = LINKS.monitoring.slice(1);

  /** The compact "On this page" control below the xl breakpoint. Closed on every page it opens on. */
  protected readonly tocOpen = signal(false);

  protected toggleToc(): void {
    this.tocOpen.update((open) => !open);
  }

  /**
   * The page cut after its opening paragraph, where the usage strip goes, and the classes it
   * documents. The title and first paragraph say what the thing is; the strip says how to use it
   * before any example does. A page with no paragraph under its title is cut after the title.
   */
  protected split(blocks: readonly DocBlock[]): {
    lead: DocBlock[];
    rest: DocBlock[];
    references: string[];
  } {
    const references = blocks.flatMap((block) => (block.kind === 'api' ? [block.reference] : []));
    const [first, ...others] = blocks;
    const title = first?.kind === 'html' ? first.html.indexOf('</h1>') : -1;
    if (!first || first.kind !== 'html' || title === -1) {
      return { lead: [], rest: [...blocks], references };
    }
    const afterTitle = title + '</h1>'.length;
    const paragraph = /^\s*<p[\s>][\s\S]*?<\/p>/.exec(first.html.slice(afterTitle));
    const cut = afterTitle + (paragraph?.[0].length ?? 0);
    return {
      lead: [{ kind: 'html', html: first.html.slice(0, cut) }],
      rest: [{ kind: 'html', html: first.html.slice(cut) }, ...others],
      references,
    };
  }

  /**
   * The next page to read, skipping a `branch` (see `NavItem.branch`): reachable from its own
   * parent, prerendered and in the sitemap like any other page, but not where the pager sends a
   * reader who just finished the page before it.
   */
  protected readonly next = computed(() => {
    const at = READING_ORDER.findIndex((item) => item.path === this.path());
    if (at === -1) return undefined;
    return READING_ORDER.slice(at + 1).find((item) => !item.branch);
  });

  /** The page before, skipping a `branch` the same way `next` does. */
  protected readonly previous = computed(() => {
    const at = READING_ORDER.findIndex((item) => item.path === this.path());
    if (at === -1) return undefined;
    return READING_ORDER.slice(0, at)
      .reverse()
      .find((item) => !item.branch);
  });

  /**
   * Applies the page's own title, description and breadcrumbs, or `Seo.notFound()` when there is
   * no document. An `effect`, because this component is reused across markdown pages (see `path`'s
   * own doc comment) and a value set only in the constructor would never be revisited.
   */
  constructor() {
    effect(() => {
      const page = this.doc();
      if (page === null) {
        this.seo.notFound();
        return;
      }
      if (page) {
        this.tocOpen.set(false);
        const path = this.path();
        this.seo.apply({
          title: titleFor(page.attributes.title ?? path),
          // A summary's inline code is markup here, where search results and link previews show it raw.
          description: page.attributes.summary?.replaceAll('`', '') ?? DEFAULT_DESCRIPTION,
          path: `/${path}`,
          type: 'article',
          breadcrumbs: breadcrumbsFor(path),
        });
      }
    });
  }
}
