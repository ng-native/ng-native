/**
 * A post's page: the title block and cover, the contents beside the prose, the byline, and the
 * other posts after it. Routed once per post by `routes.ts`, which binds `slug` and the `prose`
 * it loaded from `posts/<slug>.md`.
 */
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DocModule } from '../content.ts';
import { avatar } from '../landing/content.ts';
import { Seo } from '../seo.ts';
import { SITE_NAME } from '../site.ts';
import { BlogContent } from './blog-content.ts';
import { BlogCover } from './blog-cover.ts';
import { BlogFrame } from './blog-frame.ts';
import { BLOG_POSTS, coverImage, postDate } from './posts.ts';

@Component({
  selector: 'blog-article',
  imports: [BlogContent, BlogCover, BlogFrame, RouterLink],
  template: `
    @let post = this.post();
    <blog-frame [announce]="false">
      <article aria-labelledby="post-title">
        <div class="mx-auto max-w-[80rem] px-[var(--gutter)] pt-14">
          <div class="mx-auto max-w-[50rem] text-center">
            <nav aria-label="Breadcrumb" class="blog-meta justify-center">
              <a class="hover:text-ink" routerLink="/blog">Blog</a>
              <span aria-hidden="true">/</span>
              <span class="text-ink">{{ post.tag }}</span>
            </nav>
            <h1
              id="post-title"
              class="landing-display mt-[1.375rem] text-[clamp(2.4rem,5vw,4.2rem)] !leading-[1.04] text-balance"
            >
              {{ post.title }}
            </h1>
            <p class="landing-prose mx-auto mt-[1.375rem] text-lg sm:text-xl">{{ post.summary }}</p>
            <div class="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
              <span class="flex items-center gap-2.5 text-left text-sm">
                <img
                  class="size-8 rounded-full"
                  [src]="avatar(post.author.github)"
                  alt=""
                  width="32"
                  height="32"
                />
                <span>
                  <span class="block font-[550]">{{ post.author.name }}</span>
                  <span class="block text-[0.8125rem] text-graphite">{{ post.author.role }}</span>
                </span>
              </span>
              <span class="blog-meta">
                <time [attr.datetime]="post.date">{{ date() }}</time>
                <span aria-hidden="true">·</span>
                <span>{{ post.minutes }} min read</span>
              </span>
            </div>
          </div>
          <blog-cover class="mx-auto mt-12 max-w-[60rem]" />
        </div>

        <div
          class="mx-auto grid max-w-[80rem] grid-cols-1 gap-12 px-[var(--gutter)] pt-16 pb-24 xl:grid-cols-[minmax(0,1fr)_minmax(0,44rem)_minmax(0,1fr)]"
        >
          <aside class="hidden min-w-0 xl:block" aria-label="On this page">
            <div class="sticky top-24">
              <p class="landing-eyebrow mb-3 !text-graphite">On this page</p>
              <nav class="blog-toc">
                @for (entry of toc(); track entry.id) {
                  <a
                    [routerLink]="[]"
                    [fragment]="entry.id"
                    [attr.data-current]="current() === entry.id"
                    >{{ entry.text }}</a
                  >
                }
              </nav>
            </div>
          </aside>
          <div class="blog-prose mx-auto w-full max-w-[44rem] min-w-0 xl:max-w-none">
            <blog-content [blocks]="prose().blocks" />
            <div class="blog-byline">
              <img [src]="avatar(post.author.github)" alt="" width="56" height="56" />
              <span
                ><strong>{{ post.author.name }}</strong> {{ post.author.bio }}</span
              >
            </div>
          </div>
        </div>
      </article>

      @if (others().length) {
        <section class="border-t border-ink/15 bg-paper-light" aria-labelledby="keep-title">
          <div class="mx-auto max-w-[80rem] px-[var(--gutter)] pt-14 pb-[5.5rem]">
            <div class="mb-8 flex items-baseline justify-between gap-4">
              <h2 id="keep-title" class="landing-display text-[1.625rem]">Keep reading</h2>
              <a class="landing-link landing-more" routerLink="/blog">All posts</a>
            </div>
            <ul class="grid grid-cols-1 gap-8 lg:grid-cols-2">
              @for (other of others(); track other.slug) {
                <li>
                  <a
                    class="blog-card flex flex-col gap-[1.125rem]"
                    [routerLink]="'/blog/' + other.slug"
                  >
                    <blog-cover [tag]="other.tag" />
                    <span class="blog-title landing-display text-[1.625rem]">{{
                      other.title
                    }}</span>
                  </a>
                </li>
              }
            </ul>
          </div>
        </section>
      }
    </blog-frame>
  `,
})
export class BlogArticle {
  readonly slug = input.required<string>();
  readonly prose = input.required<DocModule>();

  protected readonly avatar = avatar;
  protected readonly post = computed(() => {
    const post = BLOG_POSTS.find((entry) => entry.slug === this.slug());
    if (!post) throw new Error(`No blog post ${this.slug()}`);
    return post;
  });
  protected readonly date = computed(() => postDate(this.post().date));
  /** The post's sections, for the contents beside it. */
  protected readonly toc = computed(() =>
    this.prose().headings.filter((heading) => heading.level === 2),
  );
  protected readonly others = computed(() =>
    BLOG_POSTS.filter((entry) => entry.slug !== this.slug()),
  );
  /** The section being read: the last heading above the top third of the window. */
  protected readonly current = signal<string | null>(null);

  constructor() {
    const seo = inject(Seo);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const post = this.post();
      seo.apply({
        title: `${post.title} - ${SITE_NAME}`,
        description: post.summary,
        path: `/blog/${post.slug}`,
        type: 'article',
        image: coverImage(post),
      });
      const headings = this.toc()
        .map((entry) => document.getElementById(entry.id))
        .filter((heading): heading is HTMLElement => heading !== null);
      const observer = new IntersectionObserver(
        () => {
          const passed = headings.filter((h) => h.getBoundingClientRect().top < innerHeight / 3);
          this.current.set(passed.at(-1)?.id ?? headings[0]?.id ?? null);
        },
        { rootMargin: '0px 0px -66% 0px' },
      );
      headings.forEach((heading) => observer.observe(heading));
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
