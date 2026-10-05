import { Component, InjectionToken, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { injectMarkdownPage } from '../../router/src/markdown-page.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-about', imports: [Text], template: `<text>about</text>` })
export class About {}

@Component({ selector: 'x-login', imports: [Text], template: `<text>login</text>` })
export class Login {}

@Component({ selector: 'x-user', imports: [Text], template: `<text>user {{ id() }}</text>` })
export class User {
  readonly id = input.required<string>();
}

@Component({ selector: 'x-post', imports: [Text], template: `<text>post {{ slug() }}</text>` })
export class Post {
  readonly slug = input.required<string>();
}

/** A catch-all page, with the rest of the url as `slug`. */
@Component({ selector: 'x-docs', imports: [Text], template: `<text>docs [{{ slug() }}]</text>` })
export class Docs {
  readonly slug = input.required<string>();
}

@Component({ selector: 'x-missing', imports: [Text], template: `<text>missing</text>` })
export class Missing {}

/** A layout: its folder's pages are a stack of their own inside it. */
@Component({
  selector: 'x-products',
  imports: [NativeStackOutlet, Text],
  template: `<text>products layout</text><native-stack-outlet />`,
})
export class Products {}

@Component({ selector: 'x-product-list', imports: [Text], template: `<text>product list</text>` })
export class ProductList {}

@Component({
  selector: 'x-product',
  imports: [Text],
  template: `<text>product {{ productId() }}</text>`,
})
export class Product {
  readonly productId = input.required<string>();
}

export const GREETING = new InjectionToken<string>('greeting');

/** Resolves each time it runs, so a test can count the runs. */
export const resolved = { runs: 0 };

/** Shows what its `routeMeta` gave its route. */
@Component({
  selector: 'x-titled',
  imports: [Text],
  template: `<text>titled {{ title }} {{ data }} {{ greeting }}</text>`,
})
export class Titled {
  private readonly route = inject(ActivatedRoute);
  protected readonly title = this.route.snapshot.title;
  protected readonly data = this.route.snapshot.data['kind'];
  protected readonly greeting = inject(GREETING);
}

@Component({ selector: 'x-draft', imports: [Text], template: `<text>draft</text>` })
export class Draft {}

@Component({ selector: 'x-secret', imports: [Text], template: `<text>secret</text>` })
export class Secret {}

/** What a `.md` page is drawn with: its file, from `injectMarkdownPage()`. */
@Component({
  selector: 'x-markdown-page',
  imports: [Text],
  template: `<text
    >markdown {{ page.filename }} [{{ page.slug }}] {{ title }}: {{ page.content }}</text
  >`,
})
export class MarkdownPage {
  protected readonly page = injectMarkdownPage();
  protected readonly title = inject(ActivatedRoute).snapshot.title;
}

/** A layout holding a tab bar, whose first tab is its folder's index page, at `''`. */
@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="" title="Home" />
      <native-tab path="schedule" title="Schedule" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({ selector: 'x-schedule', imports: [Text], template: `<text>schedule</text>` })
export class Schedule {}
