---
__default__: patch
---

`@layer` in a component's or a library's stylesheet orders its rules as a browser does, where the block was refused and every rule in it lost.

A rule in a layer loses to every rule outside one whatever their specificity, a layer loses to each one named after it, and `!important` turns that order round. `@layer a, b;`, nested layers and layers with no name are read. Layers are ordered within a stylesheet: a layer of the same name in two sheets takes the place each sheet gave it. A library compiled with `libraryStyles` keeps what it ships in a layer, such as the Angular CDK's overlay stacking and backdrop.
