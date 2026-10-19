---
__default__: patch
---

`@ng-native/web-compat` gives nodes the rest of the DOM tree a browser library walks and changes.

That is live `childNodes` and `children`, `append`, `prepend`, `replaceChildren`, `replaceChild`,
`before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `cloneNode`, `getRootNode`,
`compareDocumentPosition`, `isEqualNode`, `normalize`, the words of a text or a comment (`data`,
`splitText` and the rest), and live `getElementsByTagName`, `getElementsByClassName` and
`getElementsByName`, each checked as a browser checks an insertion first.
`document.createDocumentFragment`, `createTreeWalker` and `createNodeIterator` are there, the
document holds its doctype and its element as a browser's does, and `MutationObserver`, `NodeList`,
`HTMLCollection`, `Text`, `Comment` and `DocumentFragment` are globals while an app that asked for
the package is up.
