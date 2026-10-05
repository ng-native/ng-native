# Analog Showroom

[Analog](https://analogjs.org)'s file-based routing, running as native iOS and Android views. Every
screen is an Analog page in `src/app/pages`, routed by `createRoutes` from `@analogjs/router`
through `@ng-native/analog`, and each one shows the file that made it, what the feature does, and
the feature working.

| Feature                | File                                                      | What the page shows                                             |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Static page            | `about.page.ts`                                           | A file's path is its URL: `/about`                              |
| Dynamic parameter      | `products/[productId].page.ts`                            | The `productId` it was opened with, as an input                 |
| Nested layout          | `products.page.ts`, `products/index.page.ts`              | A list on the layout's own stack, in a sheet, pushing items     |
| Catch-all              | `docs/[...slug].page.ts`                                  | Every segment after `/docs`, for paths of any depth             |
| Route group            | `(account)/profile.page.ts`, `(account)/settings.page.ts` | URLs with no `(account)` in them                                |
| Tabs                   | `tabs.page.ts`, `tabs/index.page.ts`, `tabs/laps.page.ts` | A native tab bar whose tabs are pages, each kept as it was left |
| Native components      | `components.page.ts`                                      | Inputs, switches, a stepper, photos and a modal, all native     |
| More native components | `more-components.page.ts`                                 | A podcast library: recycled and sectioned lists, a swiped card  |
| `routeMeta` title      | `titled.page.ts`                                          | The native header's title, from `routeMeta.title`               |
| `routeMeta` redirect   | `old-home.page.ts`                                        | No component: `/old-home` lands on the home page                |
| `routeMeta` guard      | `admin.page.ts`                                           | Refused until Admin access is turned on in Settings             |
| `routeMeta` resolver   | `resolved.page.ts`                                        | Data a resolver loaded before the page was shown                |
| Lazy loading           | `lazy.page.ts`                                            | A page's code runs on first open (its own file in dev and web)  |
| Query parameters       | `search.page.ts`                                          | `?q=` read from `ActivatedRoute`, followed as it changes        |
| Markdown               | `markdown.page.ts`                                        | A document drawn natively by `<markdown>`, its links routed     |
| Markdown editor        | `editor.page.ts`                                          | Markdown typed on the device, drawn as it changes               |
| Styled Markdown        | `styled.page.ts`                                          | One document in three looks, switched through `[classes]`       |
| Blog                   | `blog/index.page.ts`, `blog/[slug].page.ts`               | The posts in `src/content`, read with `injectContent`           |
| Markdown page          | `colophon.md`                                             | A `.md` file as a page, titled by its front matter              |

The home page is `index.page.ts`. The product pages open as a sheet (a modal on Android, where React
Native Screens does not render a nested stack in a form sheet): a presented screen has no navigation
bar of its own, and the stack in `products.page.ts` gives its pages a header and a back button. A
link that launches the app opens with the pages it sits under beneath it (`withLinkParent` in
`app.config.ts`), so a product opened that way has the list and the home page to close back to.

The blog's posts are the `.md` files in `src/content`. Metro parses each one's front matter and
lexes its Markdown as it bundles, `provideContentFiles` in `app.config.ts` hands them to
`injectContentFiles` and `injectContent`, and each post is drawn from its tokens. `colophon.md` is
drawn by `ui/markdown-page.ts`, the component `pageRoutes` is given as `markdownPage`.

## Run it

From the repository root, after `pnpm install`:

```sh
cd examples/analog
pnpm start     # press i or a, or scan the QR code with Expo Go
pnpm test      # Vitest in Node, no simulator
```

`src/app/app.test.ts` opens each feature from the home page and checks what it demonstrates: the
parameter's value, the caught segments, the group's URLs, each tab keeping its count, the header
title, the redirect landing home, the guard letting in only while Admin access is on, the resolved
data and the query value, that a product a link launched the app on closes with Done, the blog's
list and posts, a missing post's fallback, and the Markdown page. It feeds the same pages and posts
to the app from `import.meta.glob`, since Vitest has no `require.context`.

## The Analog logo

The logo on the home page, drawn by `NgIcon` from `@ng-native/icons`, and the app icon
(`assets/icon.png`) are the Analog logo from the
[analogjs/analog](https://github.com/analogjs/analog) repository, under its MIT license. The file
there clips each shape to a rectangle, which `NgIcon` does not draw; every shape already lies inside
its rectangle, so `src/app/ui/analog-logo.ts` leaves the clips out and rounds the coordinates.
