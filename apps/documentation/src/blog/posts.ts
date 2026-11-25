/**
 * Every post on the blog, newest first: what the index lists, what each post's header shows,
 * what `routes.ts` routes and what `build/prerender.ts` snapshots and puts in the feed.
 *
 * A post's prose is its own component in `posts/`, loaded only when it is read.
 */
import type { Type } from '@angular/core';

export interface BlogAuthor {
  readonly name: string;
  readonly role: string;
  /** The GitHub handle, whose avatar is in `public/people`. */
  readonly github: string;
}

export interface BlogPost {
  /**
   * The post's permanent address under `/blog/`, and its feed `guid`. Never change it once the
   * post is published, or every link to it and every feed reader's copy breaks.
   */
  readonly slug: string;
  readonly title: string;
  /** One sentence: the index's lead, the post's standfirst and its description. */
  readonly summary: string;
  /** ISO date. */
  readonly date: string;
  readonly minutes: number;
  readonly tag: 'Announcement' | 'Release' | 'Guide';
  readonly author: BlogAuthor;
  /** The file the post's prose is in, for the sitemap's `lastmod`. */
  readonly source: string;
  readonly load: () => Promise<Type<unknown>>;
}

const ASHLEY: BlogAuthor = { name: 'Ashley Hunter', role: 'Project lead', github: 'ashley-hunter' };

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: 'maintained-by-coralogix',
    title: 'Angular Native is now maintained by Coralogix',
    summary:
      'The project has a long-term home. The license, the repository and the way we work stay exactly as they are.',
    date: '2026-11-24',
    minutes: 4,
    tag: 'Announcement',
    author: ASHLEY,
    source: 'src/blog/posts/coralogix.ts',
    load: () => import('./posts/coralogix.ts').then((m) => m.CoralogixPost),
  },
];

/** `2026-11-24` -> `24 November 2026`, the same on every machine that renders it. */
export function postDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The post's social preview: its cover, captured by `build/prerender.ts` when the site is built. */
export function coverImage(post: BlogPost): string {
  return `/blog/${post.slug}.png`;
}
