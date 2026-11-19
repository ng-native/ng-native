#include "view-widget.h"

#include "box-paint.h"
#include "cairo-canvas.h"
#include "image-view.h"
#include "focus.h"
#include "scroll-view.h"
#include "text-field.h"

#include "ngn/view-box.h"
#include "ngn/view-transform.h"

#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteState.h>

#include <cmath>
#include <utility>

using namespace facebook::react;

struct _NgnView {
  GtkWidget parent_instance;
  ngn::gtk::ViewData *data;
};

G_DEFINE_TYPE(NgnView, ngn_view, GTK_TYPE_WIDGET)

namespace {

using ngn::gtk::ViewData;

void viewMeasure(GtkWidget *widget, GtkOrientation orientation, int, int *minimum, int *natural, int *, int *) {
  // Yoga sizes every view; GTK asks for nothing. A scroll view's document asks for the content's
  // size, which its viewport scrolls over.
  ngn::gtk::ScrollBox *box = NGN_VIEW(widget)->data->documentOf;
  Float size = !box ? 0 : orientation == GTK_ORIENTATION_HORIZONTAL ? box->content.width : box->content.height;
  *minimum = static_cast<int>(std::ceil(size));
  *natural = *minimum;
}

// Where a child goes in its parent: its frame's origin, then its transform about its top left.
GskTransform *childTransform(const ViewData &child) {
  const auto &origin = child.layout.frame.origin;
  graphene_point_t point;
  graphene_point_init(&point, static_cast<float>(origin.x), static_cast<float>(origin.y));
  GskTransform *transform = gsk_transform_translate(nullptr, &point);
  if (auto props = std::dynamic_pointer_cast<const ViewProps>(child.props)) {
    if (auto layer = ngn::layerTransform(*props, child.layout)) {
      // In 2D steps where it has no perspective: GSK's cairo renderer, which a machine with no GL
      // and the host's screenshots draw with, draws a 3D matrix as a pink box.
      if (auto steps = ngn::planeSteps(*layer)) {
        graphene_point_t by;
        graphene_point_init(&by, static_cast<float>(steps->translateX), static_cast<float>(steps->translateY));
        transform = gsk_transform_translate(transform, &by);
        transform = gsk_transform_rotate(transform, static_cast<float>(steps->rotate));
        transform = gsk_transform_skew(transform, static_cast<float>(steps->skewX), 0);
        return gsk_transform_scale(transform, static_cast<float>(steps->scaleX), static_cast<float>(steps->scaleY));
      }
      float values[16];
      for (int i = 0; i < 16; ++i) {
        values[i] = static_cast<float>(layer->matrix[i]);
      }
      graphene_matrix_t matrix;
      graphene_matrix_init_from_float(&matrix, values);
      transform = gsk_transform_matrix(transform, &matrix);
    }
  }
  return transform;
}

void viewSizeAllocate(GtkWidget *widget, int width, int height, int) {
  ViewData *d = NGN_VIEW(widget)->data;
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (!NGN_IS_VIEW(child)) {
      if (GTK_IS_POPOVER(child)) {
        // A popover anchored to the view (screens.h), which its parent places as it allocates.
        gtk_popover_present(GTK_POPOVER(child));
      } else if (d->field && child == ngn::gtk::fieldWidget(*d->field)) {
        ngn::gtk::allocateTextField(*d, width, height);
      } else if (d->scroll && child == d->scroll->scrolled) {
        ngn::gtk::allocateScrollView(*d, width, height);
      } else if (auto *frame = static_cast<const Rect *>(g_object_get_data(G_OBJECT(child), "ngn-frame"))) {
        // A source list over its sections (split-view.h).
        GtkAllocation all{static_cast<int>(std::round(frame->origin.x)), static_cast<int>(std::round(frame->origin.y)),
                          static_cast<int>(std::ceil(frame->size.width)), static_cast<int>(std::ceil(frame->size.height))};
        gtk_widget_size_allocate(child, &all, -1);
      } else if (child == d->control || child == d->split) {
        GtkAllocation all{0, 0, width, height};
        gtk_widget_size_allocate(child, &all, -1);
      }
      continue;
    }
    if (d->surface) {
      // The surface's root fills it: Fabric gives the root no frame of its own.
      GtkAllocation all{0, 0, width, height};
      gtk_widget_size_allocate(child, &all, -1);
      continue;
    }
    ViewData *c = NGN_VIEW(child)->data;
    const auto &size = c->layout.frame.size;
    gtk_widget_allocate(
        child, static_cast<int>(std::ceil(size.width)), static_cast<int>(std::ceil(size.height)), -1, childTransform(*c));
  }
  if (d->surface && (width != d->width || height != d->height)) {
    d->width = width;
    d->height = height;
    if (d->resized) {
      d->resized(width, height);
    }
  }
}

void snapshotText(ViewData *d, GtkSnapshot *snapshot) {
  if (!d->text) {
    auto state = std::static_pointer_cast<const ConcreteState<ParagraphState>>(d->state);
    const auto &data = state->getData();
    const auto &insets = d->layout.contentInsets;
    Float width = d->layout.frame.size.width - insets.left - insets.right;
    // A hair of slack, so the width Yoga rounded to the pixel lays out the lines measure did.
    d->text = ngn::gtk::layoutText(data.attributedString, data.paragraphAttributes, width + 0.5f);
  }
  const auto &insets = d->layout.contentInsets;
  gtk_snapshot_save(snapshot);
  graphene_point_t at;
  graphene_point_init(&at, static_cast<float>(insets.left), static_cast<float>(insets.top + d->text->top));
  gtk_snapshot_translate(snapshot, &at);
  // React Native's default text colour; a run with its own colour carries it as an attribute.
  GdkRGBA black{0, 0, 0, 1};
  gtk_snapshot_append_layout(snapshot, d->text->layout, &black);
  gtk_snapshot_restore(snapshot);
}

// An svg's document, drawn with cairo in the view's bounds, as the macOS host draws it in its own.
void snapshotSvg(GtkWidget *widget, ViewData *d, GtkSnapshot *snapshot) {
  const auto &size = d->layout.frame.size;
  if (!d->svg || size.width <= 0 || size.height <= 0) {
    // What it drew before is no longer held.
    if (d->svgImages) {
      d->svgImages->drawn();
    }
    return;
  }
  graphene_rect_t bounds;
  graphene_rect_init(&bounds, 0, 0, static_cast<float>(size.width), static_cast<float>(size.height));
  cairo_t *cr = gtk_snapshot_append_cairo(snapshot, &bounds);
  cairo_rectangle(cr, 0, 0, size.width, size.height);
  cairo_clip(cr);
  // An <image> loaded later draws the svg again, while the view is there to draw.
  GWeakRef *weak = g_new0(GWeakRef, 1);
  g_weak_ref_init(weak, widget);
  auto ref = std::shared_ptr<GWeakRef>(weak, [](GWeakRef *w) {
    g_weak_ref_clear(w);
    g_free(w);
  });
  if (!d->svgImages) {
    d->svgImages = std::make_shared<ngn::gtk::SvgImageHold>();
  }
  auto canvas = ngn::gtk::makeCairoCanvas(cr, size.width, size.height, gtk_widget_get_scale_factor(widget), [ref] {
    if (auto *view = static_cast<GtkWidget *>(g_weak_ref_get(ref.get()))) {
      gtk_widget_queue_draw(view);
      g_object_unref(view);
    }
  }, d->svgImages.get());
  ngn::drawSvg(*d->svg, size.width, size.height, *canvas);
  d->svgImages->drawn();
  cairo_destroy(cr);
}

void viewSnapshot(GtkWidget *widget, GtkSnapshot *snapshot) {
  ViewData *d = NGN_VIEW(widget)->data;
  bool clipped = false;
  if (auto props = std::dynamic_pointer_cast<const ViewProps>(d->props)) {
    auto box = ngn::describeBox(*props, d->layout);
    // An Image's picture fills its bounds under its border, as a layer's contents do on macOS.
    ngn::gtk::appendBox(snapshot, box, d->image ? std::function<void()>([&] { ngn::gtk::snapshotImage(*d, snapshot, box); }) : nullptr);
    if (d->component == "Paragraph" && d->state) {
      snapshotText(d, snapshot);
    }
    snapshotSvg(widget, d, snapshot);
    ngn::gtk::snapshotPlaceholder(*d, snapshot);
    clipped = ngn::gtk::pushOverflowClip(snapshot, box);
  }
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (GTK_IS_NATIVE(child)) {
      // A popover is a surface of its own.
      continue;
    }
    gtk_widget_snapshot_child(widget, child, snapshot);
  }
  if (clipped) {
    gtk_snapshot_pop(snapshot);
  }
}

void viewDispose(GObject *object) {
  GtkWidget *widget = GTK_WIDGET(object);
  ngn::gtk::ViewData *d = NGN_VIEW(object)->data;
  ngn::gtk::destroyTextField(*d);
  ngn::gtk::destroyImage(*d);
  ngn::gtk::destroyScrollView(*d);
  while (GtkWidget *child = gtk_widget_get_first_child(widget)) {
    gtk_widget_unparent(child);
  }
  G_OBJECT_CLASS(ngn_view_parent_class)->dispose(object);
}

void viewFinalize(GObject *object) {
  delete NGN_VIEW(object)->data;
  G_OBJECT_CLASS(ngn_view_parent_class)->finalize(object);
}

} // namespace

static void ngn_view_class_init(NgnViewClass *klass) {
  GtkWidgetClass *widget = GTK_WIDGET_CLASS(klass);
  widget->measure = viewMeasure;
  widget->size_allocate = viewSizeAllocate;
  widget->snapshot = viewSnapshot;
  gtk_widget_class_set_css_name(widget, "ngn-view");
  G_OBJECT_CLASS(klass)->dispose = viewDispose;
  G_OBJECT_CLASS(klass)->finalize = viewFinalize;
}

static void ngn_view_init(NgnView *self) {
  self->data = new ViewData();
  self->data->widget = GTK_WIDGET(self);
}

namespace ngn::gtk {

GtkWidget *makeViewWidget(GtkAccessibleRole role) {
  GtkWidget *widget = GTK_WIDGET(g_object_new(NGN_TYPE_VIEW, "accessible-role", role, nullptr));
  // A view's own focus, the same for one made as the view mounts and one replacing it.
  watchFocus(widget);
  return widget;
}

GtkWidget *makeSurfaceWidget(SurfaceId surfaceId, std::function<void(int, int)> resized) {
  GtkWidget *widget = makeViewWidget();
  ViewData *d = viewData(widget);
  d->surface = true;
  d->surfaceId = surfaceId;
  d->resized = std::move(resized);
  gtk_widget_set_hexpand(widget, TRUE);
  gtk_widget_set_vexpand(widget, TRUE);
  gtk_widget_set_overflow(widget, GTK_OVERFLOW_HIDDEN);
  return widget;
}

ViewData *viewData(GtkWidget *widget) {
  return widget && NGN_IS_VIEW(widget) ? NGN_VIEW(widget)->data : nullptr;
}

void swapViewData(GtkWidget *a, GtkWidget *b) {
  std::swap(NGN_VIEW(a)->data, NGN_VIEW(b)->data);
  NGN_VIEW(a)->data->widget = a;
  NGN_VIEW(b)->data->widget = b;
}

void forgetText(ViewData &data) {
  data.text.reset();
}

} // namespace ngn::gtk
