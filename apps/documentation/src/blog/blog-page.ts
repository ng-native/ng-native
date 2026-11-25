/**
 * The blog's index: the newest post as a feature, the rest below it, and the ways to follow
 * along. The tag filters appear once the posts span more than one tag.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { avatar, LINKS } from '../landing/content.ts';
import { Seo } from '../seo.ts';
import { SITE_NAME } from '../site.ts';
import { BlogCover } from './blog-cover.ts';
import { BlogFrame } from './blog-frame.ts';
import { BLOG_POSTS, postDate, type BlogPost } from './posts.ts';

@Component({
  selector: 'blog-page',
  imports: [BlogCover, BlogFrame, RouterLink],
  template: `
    <blog-frame>
      <section
        class="mx-auto max-w-[80rem] px-[var(--gutter)] pt-16 pb-14 lg:pt-[4.5rem]"
        aria-labelledby="blog-title"
      >
        <div class="flex flex-wrap items-end justify-between gap-x-14 gap-y-6">
          <div>
            <p class="landing-eyebrow">Blog</p>
            <h1 id="blog-title" class="landing-display mt-4 text-[clamp(2.6rem,5vw,4rem)]">
              News from Angular Native.
            </h1>
            <p class="landing-prose mt-[1.125rem]">
              Announcements, releases and notes from the people who build it.
            </p>
          </div>
          @if (tags().length > 1) {
            <div class="flex flex-wrap gap-2" role="group" aria-label="Filter posts">
              <button
                type="button"
                class="blog-chip"
                [attr.aria-pressed]="tag() === null"
                (click)="tag.set(null)"
              >
                All posts
              </button>
              @for (name of tags(); track name) {
                <button
                  type="button"
                  class="blog-chip"
                  [attr.aria-pressed]="tag() === name"
                  (click)="tag.set(name)"
                >
                  {{ name }}s
                </button>
              }
            </div>
          }
        </div>
      </section>

      @if (featured(); as post) {
        <section
          class="mx-auto max-w-[80rem] px-[var(--gutter)] pb-[4.5rem]"
          aria-label="Featured post"
        >
          <a
            class="blog-card grid grid-cols-1 items-center gap-x-14 gap-y-8 lg:grid-cols-2"
            [routerLink]="'/blog/' + post.slug"
          >
            <blog-cover [tag]="post.tag" />
            <div class="flex flex-col gap-[1.125rem]">
              <span class="blog-meta">
                <span>{{ date(post) }}</span
                ><span aria-hidden="true">·</span><span>{{ post.minutes }} min read</span>
              </span>
              <h2
                class="blog-title landing-display text-[clamp(2rem,3.4vw,2.75rem)] !leading-[1.08]"
              >
                {{ post.title }}
              </h2>
              <p class="landing-prose text-lg">{{ post.summary }}</p>
              <span class="flex items-center gap-2.5 text-sm">
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
            </div>
          </a>
        </section>
      }

      <section class="border-t border-ink/15" aria-labelledby="more-title">
        <div class="mx-auto max-w-[80rem] px-[var(--gutter)] pt-14 pb-24">
          @if (rest().length) {
            <h2 id="more-title" class="landing-display mb-8 text-[1.625rem]">More posts</h2>
            <ul class="grid grid-cols-1 gap-x-8 gap-y-12 lg:grid-cols-2">
              @for (post of rest(); track post.slug) {
                <li>
                  <a
                    class="blog-card flex flex-col gap-[1.125rem]"
                    [routerLink]="'/blog/' + post.slug"
                  >
                    <blog-cover [tag]="post.tag" />
                    <span class="blog-meta">
                      <span>{{ date(post) }}</span
                      ><span aria-hidden="true">·</span><span>{{ post.minutes }} min read</span>
                    </span>
                    <span class="blog-title landing-display text-[1.625rem] !leading-[1.15]">{{
                      post.title
                    }}</span>
                    <span class="text-base text-ink/72">{{ post.summary }}</span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <h2 id="more-title" class="sr-only">Follow along</h2>
          }

          <div class="blog-follow" [class.mt-[4.5rem]]="rest().length">
            <div>
              <span class="landing-display block text-2xl">Stay up to date</span>
              <span class="mt-1.5 block text-[0.9375rem] text-[#f4f4f5]/70">
                New posts arrive with each release. Follow along however suits you.
              </span>
            </div>
            <div class="flex flex-wrap gap-2.5">
              <a class="blog-follow-link" href="/blog/rss.xml">
                <svg class="size-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M5 11a8 8 0 0 1 8 8M5 4a15 15 0 0 1 15 15"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                  <circle cx="6" cy="18" r="1.5" fill="currentColor" />
                </svg>
                RSS feed
              </a>
              <a class="blog-follow-link" [href]="links.releases">GitHub releases</a>
            </div>
          </div>
        </div>
      </section>
    </blog-frame>
  `,
})
export class BlogPage {
  protected readonly links = LINKS;
  protected readonly avatar = avatar;
  protected readonly tag = signal<BlogPost['tag'] | null>(null);
  protected readonly tags = computed(() => [...new Set(BLOG_POSTS.map((post) => post.tag))]);
  private readonly posts = computed(() => {
    const tag = this.tag();
    return BLOG_POSTS.filter((post) => tag === null || post.tag === tag);
  });
  protected readonly featured = computed(() => this.posts()[0]);
  protected readonly rest = computed(() => this.posts().slice(1));

  constructor() {
    inject(Seo).apply({
      title: `Blog - ${SITE_NAME}`,
      description: 'Announcements, releases and notes from the people who build Angular Native.',
      path: '/blog',
      type: 'website',
    });
  }

  protected date(post: BlogPost): string {
    return postDate(post.date);
  }
}
