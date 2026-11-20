// Drag and drop on GTK, as the core's input dispatcher decides it (input-dispatcher.h): a
// GtkDropTargetAsync on each surface reads a drag's file list and its text, both, and hands its
// files, urls and text to the dispatcher, which picks the `fileDrop` view under it; and a press the dispatcher turns into a drag out of a
// `[dragItem]` view starts a GDK drag with that item. Inside a Flatpak, GTK reads a dropped file
// through the document portal, so the path the app gets is one it can open.
#pragma once

#include "ngn/input-dispatcher.h"
#include "ngn/input.h"

#include <gtk/gtk.h>

namespace ngn::gtk {

// A drop's value (a GdkFileList, whose files may be any uri, or a string) as the dispatcher's items.
DragItems dropItems(const GValue *value);

// Hands drags over `widget` to `input` as the container `container`: over, out and dropped.
void attachDropTarget(GtkWidget *widget, ContainerId container, InputSink *input);

// What a drag out offers: its files as a GdkFileList and a uri list, and its text (else its url)
// as plain text. The caller owns it.
GdkContentProvider *dragContent(const DragOutItem &item);

// Starts dragging `item` out of `view`, from the pointer event that crossed the drag threshold,
// with the view's look as the drag icon; the item's file uses are held until the drag ends. Null
// when GDK would not start one.
GdkDrag *beginDragOut(GtkWidget *view, GdkEvent *event, const DragOutItem &item);

} // namespace ngn::gtk
