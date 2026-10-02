---
__default__: patch
---

A library opted in with `libraryStyles` builds when its CSS has a rule that does not parse, loads when it is minified, and reports what it drops in one line a file, with each warning behind `ANGULAR_NATIVE_LIBRARY_WARNINGS=all`.

- A rule in a library's CSS that does not parse is dropped with a warning, as a browser drops it, where it failed the build. Angular Material's slide toggle was one.
- A library's sheet is put on its component through the definition, so a class a minifier named only inside its own body gets it, where the module failed to load.
- `libraryStyles` refuses an entry point (`@acme/ui/button`), a path, a scope, white space and capital letters, naming the package to write, where each matched nothing in silence.
- A declaration whose `styles` is not a list of strings, and a file of a listed package that arrives without the list because something replaced the transform worker after `withAngularNative`, each get a warning.
- A warning about a library's CSS written on one escaped line names the literal's line and the line within its styles, where it named a line of the file that held something else.
- A file path Metro gives relative to the project is read against the project root, not the directory the build started in.
- `::ng-deep` is refused as having no encapsulation to pierce, where it was called a pseudo-element.
