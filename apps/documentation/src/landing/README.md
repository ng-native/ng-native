# The landing page

An engineering notebook in which Angular code becomes a native app: ink on white and a red accent,
with a worked example on each page of it, and a dark band near the end introducing the people at
Coralogix who maintain the project. Everything here is ordinary Angular over the DOM; what
is inside a device frame is a screenshot from a simulator or emulator.

## Where things live

| File                     | What it is                                                                      |
| ------------------------ | ------------------------------------------------------------------------------- |
| `content.ts`             | Every fact the page states: commands, links, landmarks, maintainers, star count |
| `landing.ts`             | The page: the contents and each feature section, header state                   |
| `landing.css`            | Ink, devices, code sheets, the hero's arc, the desk, the reveal, motion         |
| `header.ts`              | The stewardship bar and the header, shared with the blog                        |
| `hero.ts`                | The claim, and one app on Linux, macOS, iOS and Android beneath it              |
| `stewardship.ts`         | The maintainers, the contributors and the one Coralogix banner                  |
| `final-cta.ts`           | The way onward                                                                  |
| `footer.ts`              | The footer, shared with the blog                                                |
| `coralogix-logo.ts`      | Coralogix's official logo, from `public/brand`                                  |
| `phone.ts`               | The phone around every capture: metal edge, bezel, buttons, shadow              |
| `code-sheet.ts`          | A highlighted source file, with lit lines                                       |
| `ink.ts`                 | The drawing hand: lines, circles, arrows, routes, outlines                      |
| `reveal.ts`              | Rises a block into place the first time it scrolls into view                    |
| `../examples/*.ts`       | The other showcases - shown as source and photographed                          |
| `public/showcase/*.webp` | The phone screenshots                                                           |
| `public/desktop/*.webp`  | The macOS and Linux captures                                                    |
| `public/people/*.webp`   | Maintainers' and contributors' GitHub avatars                                   |

## The rule

Every phone is a screenshot from the iOS simulator or the Android emulator, of the source file
shown beside it, unchanged. Every desktop window is a capture of a real Angular Native app on macOS
or Linux. Every source is the file's own text. Do not edit a showcase without retaking its screenshots.

## Changing the hero's screens

The hero lays four captures along its bottom edge: an app on Linux (`public/desktop/linux-app.webp`)
and one on macOS (`mac-app.webp`), both 1400 wide with transparent corners, then `player.ts` on the
iOS simulator and `fitness.ts` on the Android emulator. The platforms section reuses the two
desktop captures beside the settings screen. Their positions are shares of one stage, in
`landing.css`'s `.hero-device` and `.desk-*` rules.

## Retaking the screenshots

The captures come from `examples/wallet`, with the showcase copied in as the app's root, running
as a development build on both platforms (a development build rather than Expo Go, which draws its
own tools button over the app). The wallet app already has Tailwind, the router and the icon
packages the showcases use.

1. Build it once per platform: `npx expo run:ios --no-bundler` and
   `npx expo run:android --no-bundler` in `examples/wallet` (Android needs a JDK 17 on
   `JAVA_HOME`).
2. Copy a showcase in as `examples/wallet/src/app/showcase.ts`, and in `src/main.ts` mount
   `import App from './app/showcase.ts'` in place of the app's own. Put both back afterwards.
3. Clean the status bars: `xcrun simctl status_bar booted override --time 9:41` on iOS, and
   Android's system UI demo mode (`clock -e hhmm 0941`).
4. Run Metro, relaunch the app and screenshot it:
   `xcrun simctl io booted screenshot` and `adb exec-out screencap -p`. For dark, set
   `xcrun simctl ui booted appearance dark` and `adb shell cmd uimode night yes` first.
5. Resize to 560 wide and save as WebP, named `<showcase>-<ios|android>-<light|dark>.webp` in
   `public/showcase`. `phone.ts` builds the path from those three parts.

## Changing a fact

Commands, links, the landmarks, the maintainers and the Expo APIs are in `content.ts`.
Anything still unconfirmed there is marked `TODO: VERIFY` - the contributor count and the star
count, at the time of writing.

## Motion

Nothing is tied to scroll position. The hero draws itself in once on first load; each section's
blocks rise into place once as they arrive (`reveal.ts`), and are then left alone. The
stewardship bar folds away once the page scrolls. Strokes ink in from `--draw`. Under
`prefers-reduced-motion: reduce` every drawing is finished and nothing moves - `landing.css`'s last
block is that design.

## Fonts and the social image

The three faces are OFL-licensed woff2 files in `public/fonts`, copied from the
`@fontsource-variable` packages of the same names, with their licenses beside them.
`build/prerender.ts` preloads the display and body faces on every page. The social image is
`public/og.png`, a 1280 x 640 card that is also the GitHub repository's social preview. The favicon is `public/favicon.svg`, the same
drawing as `mark.ts`.
