# @ng-native/schematics

`ng add` and `ng generate` for Angular Native: an Expo app added to an Angular CLI workspace,
beside its web app, with builders that let `ng serve`, `ng build` and `ng test` run it.

Alpha: APIs may change before 1.0.

## Install

```sh
ng add @ng-native/schematics
```

That writes the template's app to `projects/native`, registers it in `angular.json`, and installs
its dependencies into the workspace's root `package.json`. For an app on its own, without a
workspace, use `npx create-expo-app@latest my-app --template @ng-native/template` instead.

## Example

```sh
ng serve native                  # expo start: Metro, with Expo Go or a simulator
ng build native                  # expo export, into dist/native
ng test native                   # vitest run, on the fake Fabric
ng run native:run-ios            # expo run:ios
ng run native:typecheck          # ngc: the templates as well as the code

cd projects/native && ng generate component profile-card   # src/app/profile-card: <view>, <text>, a test
```

## What's in the package

- `collection.json` - the `ng-add`, `application` and `component` schematics.
- `builders.json` - `@ng-native/schematics:expo`, which runs an Expo CLI command in the project, and
  `@ng-native/schematics:vitest`, which runs its tests.
- `files/` - the template's source files, which a test keeps identical to `template/`.

## Docs

- [Angular CLI](https://ng-native.com/packages/schematics)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md)

## License

MIT
