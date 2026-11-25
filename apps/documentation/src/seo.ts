/**
 * The tags a page's `<head>` needs beyond what `index.html` ships as a static default: a title
 * and description specific to the page, a canonical URL, Open Graph and Twitter tags, and
 * (for a document page) `BreadcrumbList` structured data.
 *
 * `Title` and `Meta` from `@angular/platform-browser` own the tags they know how to address -
 * `<title>` and any `<meta>`. Neither has an equivalent for `<link rel="canonical">` or a
 * `<script type="application/ld+json">`, so those two are read and written directly, the same
 * way `theme.ts` already reaches the document root for the `dark` class.
 *
 * Called once per page from `landing/landing.ts` and `doc-page.ts` rather than derived here, because this
 * service has no way to know a page's title or summary on its own - that is `landing/landing.ts`'s own copy
 * and a document's front matter, and both callers already have it in hand.
 *
 * `build/prerender.ts` reads back what this produces: it waits for a route to settle and then
 * captures `document.title` and the tags this service wrote, so the same code that updates a tag
 * on a client navigation is what a crawler with no JavaScript ends up reading too.
 */
import { DOCUMENT } from '@angular/common';
import { inject, Service } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import type { Breadcrumb } from './navigation.ts';
import { OG_IMAGE, SITE_NAME, urlFor } from './site.ts';

export interface PageSeo {
  /** Already suffixed with the site name where that applies - callers own the exact wording. */
  readonly title: string;
  readonly description: string;
  /** Leading slash, no trailing one except for `/` itself - what `urlFor` expects. */
  readonly path: string;
  readonly type: 'website' | 'article';
  /** The social preview image, as a path from the site root. The site's own when unset. */
  readonly image?: string;
  readonly breadcrumbs?: readonly Breadcrumb[];
  /** Only the home page has one today: `SoftwareSourceCode`. */
  readonly structuredData?: object;
}

const STRUCTURED_DATA_ID = 'structured-data';

@Service()
export class Seo {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  apply(page: PageSeo): void {
    this.title.setTitle(page.title);
    this.meta.updateTag({ name: 'description', content: page.description });
    this.meta.removeTag('name="robots"');

    const url = urlFor(page.path);
    this.link('canonical', url);

    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:type', content: page.type });
    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME });
    const image = urlFor(page.image ?? OG_IMAGE);
    this.meta.updateTag({ property: 'og:image', content: image });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: page.title });
    this.meta.updateTag({ name: 'twitter:description', content: page.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.structuredData(
      page.structuredData ??
        (page.breadcrumbs?.length ? breadcrumbList(page.breadcrumbs) : undefined),
    );
  }

  /** A page `doc-page` could not resolve a document for - see its own `doc.error()` branch. */
  notFound(): void {
    this.title.setTitle(`Not found - ${SITE_NAME}`);
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    this.structuredData(undefined);
  }

  private link(rel: string, href: string): void {
    let element = this.document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!element) {
      element = this.document.createElement('link');
      element.setAttribute('rel', rel);
      this.document.head.appendChild(element);
    }
    element.setAttribute('href', href);
  }

  private structuredData(data: object | undefined): void {
    const existing = this.document.getElementById(STRUCTURED_DATA_ID);
    if (!data) {
      existing?.remove();
      return;
    }
    const script = existing ?? this.document.createElement('script');
    script.id = STRUCTURED_DATA_ID;
    script.setAttribute('type', 'application/ld+json');
    script.textContent = JSON.stringify(data);
    if (!existing) this.document.head.appendChild(script);
  }
}

function breadcrumbList(items: readonly Breadcrumb[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.title,
      ...(item.path ? { item: urlFor(item.path) } : {}),
    })),
  };
}
