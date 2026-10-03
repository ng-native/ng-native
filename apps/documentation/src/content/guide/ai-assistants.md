---
title: Using AI assistants
summary: What a coding agent needs to build with Angular Native, and where it finds it.
---

# Using AI assistants

A coding agent may know Angular and React Native but not Angular Native. It may write `<View>`
for `<view>`, use `document`, or reach for a `<button>`, producing code that compiles but renders
nothing. Two resources address this without setup.

## `AGENTS.md` in every new app

The template includes a root `AGENTS.md` and a `CLAUDE.md` pointing to it. They cover lowercase
element names and their imports, the absence of a DOM, styling and device-supported CSS, lists,
navigation, and commands to run the app and tests. Claude Code, Cursor, GitHub Copilot, Codex and
most other agents read one of these files automatically.

`ng add @ng-native/schematics` and `nx g @ng-native/nx:app` write the same two files into the new
app's directory, with that workspace's `ng` or `nx` commands, and leave the workspace's own
agent files alone.

The file points to Angular's own rules,
[`best-practices.md`](https://angular.dev/assets/context/best-practices.md), for everything that
is plain Angular, and says which parts of it assume a browser. Where the two disagree, the
Angular Native file wins.

Add your app's conventions as it grows.

## The docs, as text

The documentation is also available as text:

- [`/llms.txt`](/llms.txt) is the site in outline, a line on every page, following
  [llmstxt.org](https://llmstxt.org).
- Every page has a plain-markdown copy at the same address with `.md` on the end:
  [`/guide/getting-started.md`](/guide/getting-started.md).
- [`/llms-full.txt`](/llms-full.txt) is every page in one file, in reading order.

Point an agent at `/llms.txt` for a lookup, or `/llms-full.txt` to read everything before starting.
Each build generates both from the site's markdown, keeping them in sync.

## An existing app

For an app set up by hand, save [`/agents.md`](/agents.md) as `AGENTS.md` at the app's root, and
add a Commands section with the commands your app runs. It is the template's file without the
template's own commands, rebuilt from the template on every deploy of this site.
