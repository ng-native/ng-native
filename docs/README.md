# Markdown in this repository

Where a Markdown file goes, and what it has to look like. Most of these rules were already
followed by every page; this writes them down so a new page does not have to guess.

## Where a file goes

| Location                          | What lives there                                                         |
| --------------------------------- | ------------------------------------------------------------------------ |
| `docs/`                           | Notes the project keeps for itself: architecture, vocabulary, releases.  |
| `apps/documentation/src/content/` | The public documentation site, for someone building an app.              |
| `packages/<name>/README.md`       | What npm shows for a package. Short, and links to the site for the rest. |
| The repository root               | Only what GitHub or a tool looks for there (see below).                  |

`docs/` is not part of the site. The site loads `apps/documentation/src/content/**/*.md` and nothing
else, so a page for app authors goes there and never here.

The root keeps these because something depends on them being there:

- `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md` and `CODE_OF_CONDUCT.md`: GitHub links to
  them from the repository page and the new-issue and new-pull-request screens.
- `AGENTS.md`: the convention coding agents read first.

Anything else that is project-internal goes in `docs/`.

## Rules for every Markdown file

Version plans in `.nx/version-plans/` are the exception: they take no heading and are not wrapped,
since `nx release changelog` turns each body into a bullet of the release's notes under its own
heading, and the first line becomes the bullet. [RELEASING.md](./RELEASING.md#describing-changes)
gives their format.

- Prettier formats it (`pnpm format`, checked by `pnpm format:check`): 100 columns.
- One `#` heading, first in the file (after front matter, where a file has it). Headings go down one
  level at a time: `##` under `#`, `###` under `##`.
- Use the words [`CONTEXT.md`](./CONTEXT.md) defines, and avoid the ones it lists against them.
- Fence code with a language. Use `sh` or `bash` for commands, and `pnpm`, never `npm`, for anything
  run in this workspace. Instructions for someone setting up their own app keep the command that
  app's tools document, such as `npx expo install`.
- Link to another file with a relative path. Inside `docs/` that includes the `.md` extension:
  `[Architecture](./ARCHITECTURE.md)`. A package README links to `docs/` with a full
  `https://github.com/coralogix/ng-native/blob/main/docs/...` URL, because npm renders it away from
  the repository.
- When a file is moved or renamed, update every link to it in the same change. Search for the old
  name (`grep -rn "OLD.md" --exclude-dir=node_modules .`), because comments in source files and
  workflow files mention these documents too.

Names in `docs/` are `UPPER_CASE.md` for the long-lived documents that define the project
(`ARCHITECTURE.md`, `CONTEXT.md`, `RELEASING.md`) and `kebab-case.md` for anything else.

## Rules for the documentation site

Pages live in `apps/documentation/src/content/`: `guide/` for tasks and concepts, `packages/` for
reference, with a package's overview at `packages/<name>.md` and its detail pages in
`packages/<name>/`. A page is addressed by its path without the extension, so
`content/guide/forms.md` is `/guide/forms`.

- **Name.** `kebab-case.md`. A topic that grows past one page shares a prefix
  (`localization.md`, `localization-loading.md`). There are no `index.md` files.
- **Front matter.** Every page starts with:

  ```md
  ---
  title: Build a form
  summary: Signal Forms over native controls, validated and submitted, with no adapter code.
  ---
  ```

  `title` and `summary` are required. The summary is one sentence saying what the page gets you.
  `art` is optional, sets the drawing at the top of a component page, and must be one of the names
  in `DOC_ART` in `apps/documentation/src/doc-art.ts`.

- **Heading.** The `#` heading repeats the `title`. Sections are `##`.
- **Links.** Between pages, use the absolute route without an extension:
  `[Forms](/guide/forms)`. `#section` links stay on the current page.
- **Code blocks.** The languages the site highlights are `ts`, `tsx`, `js`, `html`, `css`, `json`,
  `bash`, `sh`, `diff`, `md`, `angular-ts` and `angular-html`. Any other language name renders as
  plain text.
- **Live blocks.** A line holding only `<!-- example: name -->` renders a running example, and
  `<!-- api: ClassName -->` renders an API table (`@ng-native/components#Switch` when two packages
  share a class name), and `<!-- os-support -->` the per-OS support table drawn from `OS_SUPPORT`
  in `@ng-native/device`. Each marker sits alone on its line. See `apps/documentation/build/markdown.ts`.

### Section names and order

A section that recurs across pages has one name, and a page about a service, a component or a view
runs in one order, so a reader finds the same thing in the same place on every page:

1. `Install` (or `Setup` for a package that needs configuring), then `The smallest useful
example`.
2. The page's own topic sections.
3. Platform sections, in this order: `On iOS`, `On Android`, `On macOS`, `On Linux`. A page with no
   per-OS sections but some differences uses `Platform differences`; one that works on a single OS
   says `Only on iOS` or `Only on Android`.
4. What happens without the native part: `Without the module` on an Expo page, `Off a device and
on the web` (or `Off a device`) on a device page.
5. `In a test`: how a test fakes or drives it. Never `Testing`.
6. `Reference`, last, holding the page's main `<!-- api: -->` table. A table for a second class can
   stay in the section about that class.

Shell commands are fenced `sh`, not `bash`. `apps/documentation/build/page-structure.test.ts`
checks the names, the order on `packages/expo` and `packages/device` pages, and that `Reference`
comes last; add a name there when a new recurring section settles.

### What a page leaves out

A page is for someone building an app. Leave out:

- How the package is built inside: internal file names, native class names, how a cache or a
  transform works. Say what the author sees and can do; put the mechanism in
  [ARCHITECTURE.md](./ARCHITECTURE.md) or a code comment.
- The project's own history and process: what something used to do, how a release is verified,
  what CI runs. A version-specific behaviour is stated as `On SDK 57, ...`, not as a story.
- Essays justifying a design. One sentence on why is enough.
- A second copy of something another page explains. Link to it, with a `#section` anchor where
  that helps.
- Paragraphs every page in a family would repeat. Say it once on the family's overview page (such
  as `packages/expo/using-a-module.md`) and link to it.

Build the site with `pnpm nx build documentation`, or serve it with
`pnpm --filter documentation dev`, to see a new page before opening a pull request.

## Checklist for a pull request that touches Markdown

- [ ] The file is in the right place from the table above.
- [ ] A site page has `title` and `summary`, and its `#` heading matches the `title`.
- [ ] Its sections follow [Section names and order](#section-names-and-order), and nothing in it
      is on the [leave out](#what-a-page-leaves-out) list.
- [ ] Links to and from the file still resolve.
- [ ] `pnpm format:check` passes.
