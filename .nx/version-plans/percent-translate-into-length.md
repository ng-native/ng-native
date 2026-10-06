---
'__default__': patch
---

A translate is eased between a percentage and a length, in a transition and between keyframes.

`transform: translateY(-50%)` to `translateY(-34px) scale(0.75)`, as Material's floating label moves, stepped to its end, because a share of the box and a length are not on one scale. So did `translateY(100%)` to `translateY(0)`, a zero with no unit being a length. The frames between are now two translates along the axis, `translateY(-25%) translateY(-17px)` halfway, which add up to the `calc(-25% - 17px)` a browser eases through whatever size the box is; where one of the two is nothing, the frame is the other alone. A transition turned round part way carries on from the frame it had reached. The `translate` property is eased the same way. Keyframes that go from one to the other are played from JavaScript, as any keyframes with a percentage translate are.
