# Habits

A small habit tracker built with Angular Native: four habits with a couple of months of history,
so every screen has something to show on first launch.

| Screen                                              | What it shows                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Today (`src/app/today/today.ts`)                    | A progress bar for the day, and a checklist done with a tap or a long press, with a CSS `@keyframes` animation and a haptic on completion |
| Habit (`src/app/habit-detail/habit-detail.ts`)      | A streak count and a calendar grid of the last ten weeks, laid out in CSS, with edit and delete                                           |
| New/edit habit (`src/app/habit-form/habit-form.ts`) | A Signal Form over a name (required and unique), a colour and a reminder time, presented as a modal                                       |
| Settings (`src/app/settings/settings.ts`)           | Daily reminders through `expo-notifications`, with `Permission` covering the request and the denied state, and every streak at a glance   |

Habits and their completions are kept in SQLite through `database()`
(`src/app/data/habits-database.ts`), written through best-effort: the signals in
`src/app/data/habits.ts` are the source of truth for the UI, and persistence happens in the
background, so a device with no SQLite module - Node under the tests - falls back to the seeded
data rather than breaking anything.

## Run it

From the repository root, after `pnpm install`:

```sh
cd examples/habits
pnpm start     # press i or a, or scan the QR code with Expo Go
pnpm test      # Vitest in Node, no simulator
```

`src/app/app.test.ts` drives the whole app the way a person would: checks a habit off, undoes one,
and creates a new one through the form. `src/app/data/habits.test.ts` covers the streak and
completion logic on its own, with no Angular in the picture.
