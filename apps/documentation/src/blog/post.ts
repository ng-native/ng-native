/**
 * A blog post's metadata, read from the front matter of its `posts/<slug>.md`. No Vite here:
 * `build/prerender.ts` reads the same files under plain Node for the feed and the sitemap.
 */

export interface BlogAuthor {
  readonly name: string;
  readonly role: string;
  /** The GitHub handle, whose avatar is in `public/people`. */
  readonly github: string;
  /** What follows the name in the byline under a post. */
  readonly bio: string;
}

export interface BlogPost {
  /**
   * The file's name: the post's permanent address under `/blog/` and its feed `guid`. Never rename
   * the file once the post is published, or every link to it and every feed reader's copy breaks.
   */
  readonly slug: string;
  readonly title: string;
  /** One sentence: the index's lead, the post's standfirst and its description. */
  readonly summary: string;
  /** ISO date, quoted in the front matter so YAML keeps it a string. */
  readonly date: string;
  readonly minutes: number;
  readonly tag: (typeof TAGS)[number];
  readonly author: BlogAuthor;
}

const TAGS = ['Announcement', 'Release', 'Guide'] as const;

/** Who can write a post, by the `author:` a post's front matter names. */
const AUTHORS: Record<string, BlogAuthor> = {
  'ashley-hunter': {
    name: 'Ashley Hunter',
    role: 'Project lead',
    github: 'ashley-hunter',
    bio: 'leads Angular Native at Coralogix.',
  },
};

/** A post from its file's path and front matter, failing the build on a field it cannot use. */
export function toPost(file: string, attributes: Record<string, unknown>): BlogPost {
  const { title, summary, date, minutes, tag, author } = attributes;
  const fail = (field: string) => new Error(`${file}: front matter needs a valid ${field}`);
  if (typeof title !== 'string') throw fail('title');
  if (typeof summary !== 'string') throw fail('summary');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw fail("date, '2026-11-24'");
  if (typeof minutes !== 'number') throw fail('minutes');
  if (!TAGS.includes(tag as BlogPost['tag'])) throw fail(`tag, one of ${TAGS.join(', ')}`);
  const writer = AUTHORS[author as string];
  if (!writer) throw fail('author, a key of AUTHORS in blog/post.ts');
  const slug = /([^/]+)\.md$/.exec(file)![1]!;
  return { slug, title, summary, date, minutes, tag: tag as BlogPost['tag'], author: writer };
}

export function newestFirst(posts: BlogPost[]): readonly BlogPost[] {
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

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
