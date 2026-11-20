---
__default__: patch
---

The desktop host reads `aria-labelledby` (`accessibilityLabelledBy`) and `aria-describedby` (`accessibilityDescribedBy`) on a view or a text input, each naming other views on the same window by their `nativeID` or `id`. On macOS the text of the views named is read as the view's label and help, ahead of its own `accessibilityLabel` and `accessibilityHint`, and the first view it is labelled by is its title element. On Linux they are GTK's labelled-by and described-by relations, set again on a view's new widget when a role change replaces it. Both follow the views named as they are made, deleted or given another id. The notes example describes each note's row by its preview.
