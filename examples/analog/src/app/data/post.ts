/** A blog post's front matter, in `src/content/*.md`. */
export interface PostAttributes {
  readonly title: string;
  readonly description: string;
  /** An ISO date: Metro gives a front matter date as its ISO string. */
  readonly date: string;
  readonly author: string;
}

/** `2026-10-02T00:00:00.000Z` as `October 2, 2026`. */
export function postDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
