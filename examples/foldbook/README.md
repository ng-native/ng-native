# Foldbook

A reader built with Angular Native for foldable phones. Fold it half open and it becomes a book:
the contents on one side of the fold and the chapter on the other. Lay it flat and the chapter
takes the whole screen.

| Part                               | What it shows                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Reader (`src/app/app.ts`)          | The cover while closed, two pages split at the fold, or one wide page when flat |
| Hinge (`@ng-native/expo/foldable`) | `Foldable`'s `posture`, `fold`, `separating` and `angle` signals                |

The two-page layout reads `fold().bounds`: the left page is as wide as the space before the fold, a
blank column covers the fold itself, and the right page takes the rest. It splits only while the
fold separates the screen, which is when the phone is half open. Flat, a foldable is one screen.

## Run it

It needs a foldable: the iPhone Duo simulator, which comes with Xcode 27.1, or an Android foldable
emulator. `expo-foldables` is a native module, so it runs in a development build, not Expo Go.

From the repository root, after `pnpm install`:

```sh
cd examples/foldbook
pnpm ios       # or: pnpm android
pnpm test      # Vitest in Node, no simulator
```

On the iPhone Duo simulator, open and close the phone from the Simulator's hinge control.

`src/app/app.test.ts` drives the app with a stand-in hinge: closed, half open, flat, and a phone
that does not fold.
