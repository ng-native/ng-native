# @ng-native/migrate

The migrations that update an Angular Native app to a new release. `nx migrate @ng-native/nx` and
`ng update @ng-native/schematics` run them for you; an app with neither, such as one made from
`@ng-native/template`, runs them with `npx`.

Alpha: APIs may change before 1.0.

## Install

Run it before installing the new versions - there is nothing to add as a dependency:

```sh
npx @ng-native/migrate@latest
npm install
```

## Example

```sh
npx @ng-native/migrate@latest --dry-run       # print what would change, write nothing
npx @ng-native/migrate@latest --from 0.2.0    # the version the app was on
```

It runs every migration newer than the `@ng-native/*` version the app's `package.json` lists, moves
those versions to the new release, and prints each file it changed and anything left to do by hand.

## Docs

- [Updating an app](https://ng-native.com/guide/updating) for every way to update and what each
  migration does
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md)

## License

MIT
