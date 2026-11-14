---
__default__: patch
---

`Printing` from `@ng-native/expo/printing` is a new service over `expo-print`, an optional peer: `print({ html })` or `print({ uri })` shows the print dialog, `printToPdf(html)` renders HTML to a PDF file and answers its uri, and `selectPrinter()` opens iOS's printer picker and answers the printer, or `null` when it is dismissed and on Android. Without the module, `print()` does nothing and the others answer `null`.
