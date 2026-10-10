---
'__default__': patch
---

`::ng-deep` is read where something is written before it: `:host ::ng-deep .inner` and `.panel ::ng-deep .inner` style `.inner` anywhere under that component, in the views of the components it holds as well. With nothing before it the rule is still dropped.
