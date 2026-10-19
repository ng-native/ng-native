---
__default__: patch
---

`@ng-native/web-compat` reads and writes markup (`innerHTML`, `outerHTML`, `DOMParser`, `XMLSerializer`) and gives elements their names, namespaces, attributes and reflected properties.

It also reads and writes `insertAdjacentHTML`, `setHTML` and its kin, and a `<template>`'s
`content`, parsed by parse5 as a browser parses HTML, and an XML type as XML. Elements have their
names and namespaces (`createElementNS`, `namespaceURI`, `prefix`, `localName`, `lookupNamespaceURI`
and the rest, `getElementsByTagNameNS`), attribute names in a browser's case, `getAttributeNames`,
attributes as `Attr` nodes, `dataset`, `innerText`, and the properties HTML reflects attributes as
(`hidden`, `title`, `dir`, `tabIndex`, `type`, ARIA's and the rest), and `instanceof
HTMLInputElement` and the other element interfaces answer. `document.implementation` makes HTML and
XML documents that are never drawn, with doctypes, CDATA sections and processing instructions. A
`<button>` and an `<a>` have their roles, a table's and a form's elements are views, and an element
with an id is a global by it.
