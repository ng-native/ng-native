---
__default__: patch
---

`Printing` from `@ng-native/expo/printing` is a new service over `expo-print`, an optional peer: `print({ html })` or `print({ uri })` shows the print dialog, `printToPdf(html)` renders HTML to a PDF file and answers its uri, and `selectPrinter()` opens iOS's printer picker and answers the printer, or `null` when it is dismissed and on Android. Where the service is absent, on the web and in a test that provides no module, `print()` does nothing and the others answer `null`; on iOS, Android and macOS a build without the module throws a `MissingModuleError` when one is called.
