/**
 * Every post on the blog, newest first: what the index lists, what each post's header shows and
 * what `routes.ts` routes. A post is one file, `posts/<slug>.md`: its front matter is the metadata
 * (see `post.ts`), and its prose loads only when it is read.
 */
import type { DocModule } from '../content.ts';
import { newestFirst, toPost, type BlogPost } from './post.ts';

export { coverImage, postDate, type BlogAuthor, type BlogPost } from './post.ts';

const attributes = import.meta.glob<Record<string, unknown>>('./posts/*.md', {
  eager: true,
  query: '?meta',
  import: 'attributes',
});
const bodies = import.meta.glob<DocModule>('./posts/*.md');

export const BLOG_POSTS = newestFirst(
  Object.entries(attributes).map(([file, front]) => toPost(file, front)),
);

/** A post's prose, as `build/markdown.ts` renders it. */
export function loadPost(slug: string): Promise<DocModule> {
  return bodies[`./posts/${slug}.md`]!();
}
