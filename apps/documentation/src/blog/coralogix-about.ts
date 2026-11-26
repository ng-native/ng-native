/**
 * The box about Coralogix in the announcement, mounted where the post has
 * `<!-- island: coralogix-about -->`.
 */
import { Component } from '@angular/core';
import { LINKS } from '../landing/content.ts';
import { CoralogixLogo } from '../landing/coralogix-logo.ts';

@Component({
  selector: 'blog-coralogix-about',
  imports: [CoralogixLogo],
  template: `
    <aside class="blog-about" aria-labelledby="about-cx">
      <cx-logo class="h-6" tone="light" />
      <h3 id="about-cx" class="landing-display">See how your app behaves in the real world</h3>
      <p>
        Coralogix is an observability platform. Logs, metrics, traces and real user monitoring live
        in one place, so you can follow a problem from the screen a user tapped to the service that
        failed.
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
  `,
})
export class CoralogixAbout {
  protected readonly links = LINKS;
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
