---
__default__: patch
---

`@ng-native/web-compat` draws a library's SVG with react-native-svg's native views, the ones `@ng-native/icons` draws with.

An `<svg>` a template writes, markup builds or a script makes with `createElementNS` is drawn: shapes, groups, texts and their spans, a text along a path, gradients and their stops, clips, masks, markers, patterns, a drop shadow and HTML in a `foreignObject`. Its elements have SVG's names and namespace, `className` with `baseVal`, `getBBox`, `getComputedTextLength`, `ownerSVGElement` and `createSVGRect`. A style a script sets on a shape is its paint or its font, a paint that names a token is that token's colour, and a `light-dark()` paint is the side for the app's colour scheme. A `<template>` an icon's markup is bound to holds an empty box. `@ng-native/icons` is a peer dependency of the package. react-native-svg's JavaScript is never imported: without its native views a drawing shows nothing, as an icon does. An app that does not ask for the package draws its `<svg>` as it did, and icons drawn by `@ng-native/icons` commit what they did in either.
