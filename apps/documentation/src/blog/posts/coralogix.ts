/**
 * The announcement that Coralogix maintains Angular Native.
 */
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { avatar, LINKS } from '../../landing/content.ts';
import { CoralogixLogo } from '../../landing/coralogix-logo.ts';
import { BlogArticle } from '../blog-article.ts';

@Component({
  selector: 'blog-post-coralogix',
  imports: [BlogArticle, CoralogixLogo, RouterLink],
  template: `
    <blog-article slug="maintained-by-coralogix" [toc]="toc">
      <div class="blog-summary">
        <p class="landing-eyebrow mb-2.5">In short</p>
        <ul>
          <li>
            Coralogix now maintains Angular Native, so the project is set up to be well maintained
            for the long term. I continue to lead it.
          </li>
          <li>
            It stays MIT licensed and developed in the open, with the same repository and the same
            packages on npm.
          </li>
          <li>Engineers at Coralogix now contribute alongside the community.</li>
        </ul>
      </div>

      <p>
        When I started Angular Native, the goal was simple: let Angular developers build real native
        apps without learning a second framework. Since then, hundreds of you have starred the
        repository, filed issues, sent pull requests and shipped apps with it.
      </p>
      <p>
        Today I'm happy to share that the project has a long-term home.
        <strong>Coralogix now maintains Angular Native</strong>, and I'll keep leading it from
        there.
      </p>

      <h2 id="changes">What changes</h2>
      <p>
        Coralogix is committing engineering time to Angular Native for the long term. That's the
        real news here: the project now has a team and a company behind it that want it to succeed
        for years to come.
      </p>
      <p>
        If you're deciding whether to build on Angular Native, this is the reassurance you've been
        looking for. It will be well maintained going forward, with predictable releases, quicker
        answers in issues and discussions, and updates that keep pace as Angular, React Native and
        Expo move on. It also means the time to take on larger pieces of work that a side project
        struggles to finish.
      </p>

      <h2 id="same">What stays the same</h2>
      <ul>
        <li>
          <strong>The license.</strong> Angular Native is MIT licensed, and that isn't changing.
        </li>
        <li>
          <strong>The code and packages.</strong> Same repository, same <code>&#64;ng-native</code>
          packages on npm, no account or sign-up needed.
        </li>
        <li>
          <strong>How we work.</strong> Issues, discussions, pull requests and release notes stay
          public on GitHub, and decisions happen there.
        </li>
        <li>
          <strong>The community.</strong> Contributions from outside Coralogix are as welcome as
          ever, and reviewed the same way.
        </li>
      </ul>

      <figure class="blog-quote">
        <blockquote class="landing-display">
          Nothing about how you use Angular Native changes. What changes is how much time we can
          give it.
        </blockquote>
      </figure>

      <h2 id="why">Why Coralogix</h2>
      <p>
        Coralogix builds its products with Angular. We want Angular developers to reach every
        platform with the skills they already have, and looking after Angular Native is the most
        direct way to make that happen.
      </p>

      <aside class="blog-about" aria-labelledby="about-cx">
        <cx-logo class="h-6" tone="light" />
        <h3 id="about-cx" class="landing-display">See how your app behaves in the real world</h3>
        <p>
          Coralogix is an observability platform. Logs, metrics, traces and real user monitoring
          live in one place, so you can follow a problem from the screen a user tapped to the
          service that failed.
        </p>
        <ul>
          @for (tile of tiles; track tile.title) {
            <li>
              <svg class="size-5" viewBox="0 0 24 24" aria-hidden="true">
                <path [attr.d]="tile.icon" />
              </svg>
              <span class="blog-about-title">{{ tile.title }}</span>
              <span class="blog-about-text">{{ tile.body }}</span>
            </li>
          }
        </ul>
        <a class="blog-about-link" [href]="links.coralogixRum">
          Explore Coralogix for mobile
          <svg class="size-3.5" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 11 11 5M6 5h5v5" />
          </svg>
        </a>
      </aside>

      <h2 id="next">What's next</h2>
      <p>
        Desktop is the first big step. Angular Native apps now run on macOS and Linux, from the same
        components you use on iOS and Android. The details are in the
        <a [routerLink]="links.desktop">desktop guide</a>.
      </p>

      <h2 id="involved">Get involved</h2>
      <p>
        If you've built something with Angular Native, I'd love to see it. Star the repository, join
        the discussions, or pick up a good first issue.
      </p>
      <div class="mt-2 flex flex-wrap gap-3">
        <a class="landing-button" data-kind="primary" [href]="links.github">Star on GitHub</a>
        <a class="landing-button" data-kind="secondary" [href]="links.discussions"
          >Join the discussions</a
        >
      </div>

      <div class="blog-byline">
        <img [src]="avatar('ashley-hunter')" alt="" width="56" height="56" />
        <span><strong>Ashley Hunter</strong> leads Angular Native at Coralogix.</span>
      </div>
    </blog-article>
  `,
})
export class CoralogixPost {
  protected readonly links = LINKS;
  protected readonly avatar = avatar;
  protected readonly toc = [
    { id: 'changes', text: 'What changes' },
    { id: 'same', text: 'What stays the same' },
    { id: 'why', text: 'Why Coralogix' },
    { id: 'next', text: "What's next" },
    { id: 'involved', text: 'Get involved' },
  ];
  protected readonly tiles = [
    {
      title: 'Crashes and errors',
      body: 'From iOS and Android apps, with the context to reproduce them.',
      icon: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    },
    {
      title: 'Performance',
      body: "Screen loads, app starts and slow network calls on real users' devices.",
      icon: 'M12 13l3-3M5.6 19a9 9 0 1 1 12.8 0M12 13h.01',
    },
    {
      title: 'End to end',
      body: "Every session linked to your backend's logs and traces.",
      icon: 'M6 6a2 2 0 1 0 0-.01M18 18a2 2 0 1 0 0-.01M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v-1',
    },
  ];
}
