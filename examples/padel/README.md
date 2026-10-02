# Padel

A padel scorer built with Angular Native and an Apple Watch app. Score each point with a tap on the
watch or the phone, and both always show the same score. The score can also go on the lock screen and
into the Dynamic Island as a Live Activity.

| Part                                              | What it shows                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Scoreboard (`src/app/app.ts`)                     | Sets, games and the point, buttons to score, undo, golden point, and where each point came from                         |
| Scoring (`src/app/match/match.ts`)                | Deuce and advantage or golden point, sets to 6 by two, a tiebreak at 6-6, best of three                                 |
| Watch link (`src/app/match/match-store.ts`)       | `Watch` from `@ng-native/expo/watch`: the phone keeps the score, and the watch sends it points                          |
| Live Activity (`src/app/live/score-activity.tsx`) | The lock screen banner and Dynamic Island layout, kept in step by `liveActivity()` from `@ng-native/expo/live-activity` |
| Watch app (`targets/watch/PadelWatchApp.swift`)   | A SwiftUI app with a button for each side, a haptic on every tap, and a queue for when the phone is away                |

## How the phone and the watch talk

- The watch sends each point as a live message, and the phone replies with the new score.
- When the phone is out of reach, the watch queues the point with `transferUserInfo`, and the phone
  counts it when it next runs.
- Every score change goes to the watch as application context, so a watch that was asleep wakes up
  to the right score.
- Each point carries a key of its own, `rally`, so a point the watch queues again after a lost reply
  counts once. Not `id`, which iOS replaces on a message that wants a reply.

## Run it

From the repository root, after `pnpm install`, on a Mac with an iPhone simulator paired with an
Apple Watch simulator:

```sh
cd examples/padel
pnpm exec expo prebuild -p ios
pnpm ios       # builds the phone app with the watch app inside it
pnpm test      # Vitest in Node, no simulator
```

Install the watch app from the phone app's build products (`Debug-watchsimulator/PadelWatch.app`)
on the watch simulator, or from the Watch app on the phone. Without a watch, or on Android, the
phone app scores on its own.

`src/app/match/match.test.ts` covers the scoring rules, and `src/app/app.test.ts` scores from the
phone, from the watch and from the watch's queue against a stand-in for the watch.
