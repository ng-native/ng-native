---
'__default__': patch
---

A SwiftUI `font` modifier on an `@expo/ui` view can name one of the app's `@font-face` faces by the name it is registered under, such as `Nunito Sans-700`, and draws that face on iOS instead of the system font.

The build reads each face's PostScript name from its `.ttf`, `.otf`, `.ttc` or `.woff` file, and adds it to the face in the compiled sheet as `postScriptName`. A face file in a format the name cannot be read from, such as `.woff2`, is reported in the build. A font loaded by hand with `Fonts.load(map)` is still named by its PostScript name in a modifier, and in development a modifier that names it by the name it was loaded under logs a warning. `registerViewName` and `registerExpoView` take a `fontNames` option, through which a view rewrites the font names its own props carry.
