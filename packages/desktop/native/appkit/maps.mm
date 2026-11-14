#import "maps.h"

#include <algorithm>

namespace {

// expo-maps' hit size for a marker balloon on iOS, which hangs above its coordinate.
constexpr CGFloat kMarkerWidth = 40;
constexpr CGFloat kMarkerHeight = 44;

MKCoordinateRegion regionFor(const ngn::MapCamera &camera) {
  auto span = ngn::mapSpanForZoom(camera.zoom);
  return MKCoordinateRegionMake(
      CLLocationCoordinate2DMake(camera.coordinates.latitude, camera.coordinates.longitude),
      MKCoordinateSpanMake(span.latitudeDelta, span.longitudeDelta));
}

NSString *string(const std::string &text) {
  return [NSString stringWithUTF8String:text.c_str()];
}

std::vector<CLLocationCoordinate2D> points(const std::vector<ngn::MapCoordinate> &coordinates) {
  std::vector<CLLocationCoordinate2D> out;
  for (const auto &c : coordinates) {
    out.push_back(CLLocationCoordinate2DMake(c.latitude, c.longitude));
  }
  return out;
}

MKPointOfInterestFilter *filterFor(const ngn::MapModel &model) {
  auto categories = [](const std::vector<std::string> &names) {
    NSMutableArray<MKPointOfInterestCategory> *out = [NSMutableArray array];
    for (const auto &name : names) {
      [out addObject:string(name)];
    }
    return out;
  };
  if (model.pointsIncluding) {
    return [[MKPointOfInterestFilter alloc] initIncludingCategories:categories(*model.pointsIncluding)];
  }
  if (model.pointsExcluding) {
    return [[MKPointOfInterestFilter alloc] initExcludingCategories:categories(*model.pointsExcluding)];
  }
  return MKPointOfInterestFilter.filterIncludingAllCategories;
}

MKMapConfiguration *configurationFor(const ngn::MapModel &model) {
  auto elevation = model.realisticElevation ? MKMapElevationStyleRealistic : MKMapElevationStyleFlat;
  switch (model.type) {
    case ngn::MapType::Imagery:
      return [[MKImageryMapConfiguration alloc] initWithElevationStyle:elevation];
    case ngn::MapType::Hybrid: {
      auto *hybrid = [[MKHybridMapConfiguration alloc] initWithElevationStyle:elevation];
      hybrid.showsTraffic = model.traffic;
      hybrid.pointOfInterestFilter = filterFor(model);
      return hybrid;
    }
    case ngn::MapType::Standard:
    default: {
      auto *standard = [[MKStandardMapConfiguration alloc]
          initWithElevationStyle:elevation
                   emphasisStyle:model.mutedEmphasis ? MKStandardMapEmphasisStyleMuted : MKStandardMapEmphasisStyleDefault];
      standard.showsTraffic = model.traffic;
      standard.pointOfInterestFilter = filterFor(model);
      return standard;
    }
  }
}

} // namespace

NSColor *NGNMapColor(std::optional<uint32_t> argb, NSColor *fallback) {
  if (!argb) {
    return fallback;
  }
  return [NSColor colorWithSRGBRed:((*argb >> 16) & 0xff) / 255.0
                             green:((*argb >> 8) & 0xff) / 255.0
                              blue:(*argb & 0xff) / 255.0
                             alpha:((*argb >> 24) & 0xff) / 255.0];
}

// A marker, by its place in the model's list.
@interface NGNMapMarker : MKPointAnnotation
@property (nonatomic) NSUInteger index;
@end

@implementation NGNMapMarker
@end

@implementation NGNMap {
  NGNMapEvents _events;
  NGNMapAccess _access;
  ngn::MapModel _model;
  bool _applied;
  bool _appeared;
  std::optional<ngn::MapCamera> _camera;
}

- (instancetype)initWithFrame:(NSRect)frame events:(NGNMapEvents)events access:(NGNMapAccess)access {
  if ((self = [super init])) {
    _events = std::move(events);
    _access = std::move(access);
    _mapView = [[MKMapView alloc] initWithFrame:frame];
    _mapView.delegate = self;
    auto *click = [[NSClickGestureRecognizer alloc] initWithTarget:self action:@selector(clicked:)];
    click.delaysPrimaryMouseButtonEvents = NO;
    [_mapView addGestureRecognizer:click];
  }
  return self;
}

- (void)send:(const ngn::MapEvent &)event {
  if (_events) {
    _events(event);
  }
}

- (void)apply:(const ngn::MapModel &)model {
  if (!_applied || model.givenMarkers != _model.givenMarkers) {
    NSMutableArray *old = [NSMutableArray array];
    for (id<MKAnnotation> annotation in _mapView.annotations) {
      if ([annotation isKindOfClass:NGNMapMarker.class]) {
        [old addObject:annotation];
      }
    }
    [_mapView removeAnnotations:old];
    NSMutableArray *markers = [NSMutableArray array];
    for (NSUInteger i = 0; i < model.markers.size(); i++) {
      const auto &marker = model.markers[i];
      auto *annotation = [[NGNMapMarker alloc] init];
      annotation.index = i;
      annotation.coordinate = CLLocationCoordinate2DMake(marker.coordinates.latitude, marker.coordinates.longitude);
      annotation.title = string(marker.title);
      [markers addObject:annotation];
    }
    [_mapView addAnnotations:markers];
  }
  if (!_applied || model.givenShapes != _model.givenShapes) {
    [_mapView removeOverlays:_mapView.overlays];
    for (NSUInteger i = 0; i < model.polylines.size(); i++) {
      auto coordinates = points(model.polylines[i].coordinates);
      auto count = static_cast<NSUInteger>(coordinates.size());
      MKPolyline *line = model.polylines[i].geodesic ? [MKGeodesicPolyline polylineWithCoordinates:coordinates.data() count:count]
                                                     : [MKPolyline polylineWithCoordinates:coordinates.data() count:count];
      line.title = [NSString stringWithFormat:@"polyline:%lu", (unsigned long)i];
      [_mapView addOverlay:line];
    }
    for (NSUInteger i = 0; i < model.polygons.size(); i++) {
      auto coordinates = points(model.polygons[i].coordinates);
      MKPolygon *polygon = [MKPolygon polygonWithCoordinates:coordinates.data() count:static_cast<NSUInteger>(coordinates.size())];
      polygon.title = [NSString stringWithFormat:@"polygon:%lu", (unsigned long)i];
      [_mapView addOverlay:polygon];
    }
    for (NSUInteger i = 0; i < model.circles.size(); i++) {
      const auto &circle = model.circles[i];
      MKCircle *shape = [MKCircle circleWithCenterCoordinate:CLLocationCoordinate2DMake(circle.center.latitude, circle.center.longitude)
                                                      radius:circle.radius];
      shape.title = [NSString stringWithFormat:@"circle:%lu", (unsigned long)i];
      [_mapView addOverlay:shape];
    }
  }
  if (model.camera && (!_camera || *model.camera != *_camera)) {
    _camera = model.camera;
    [_mapView setRegion:regionFor(*model.camera) animated:NO];
  }
  _mapView.preferredConfiguration = configurationFor(model);
  _mapView.showsCompass = model.compass;
  _mapView.showsScale = model.scaleBar;
  _mapView.showsPitchControl = model.pitchToggle;
  switch (model.colorScheme) {
    case ngn::MapColorScheme::Light:
      _mapView.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
      break;
    case ngn::MapColorScheme::Dark:
      _mapView.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
      break;
    case ngn::MapColorScheme::Automatic:
      _mapView.appearance = nil;
      break;
  }
  bool showsUser = ngn::mapShowsUserLocation(model, _access ? _access() : ngn::LocationSource::Authorization::Denied);
  if (_mapView.showsUserLocation != showsUser) {
    _mapView.showsUserLocation = showsUser;
  }
  _model = model;
  _applied = true;
}

- (void)appear {
  if (_appeared) {
    return;
  }
  _appeared = true;
  [self reportCamera];
}

- (void)reportCamera {
  MKCoordinateRegion region = _mapView.region;
  [self send:ngn::mapCameraMove(
                 {region.center.latitude, region.center.longitude},
                 {region.span.latitudeDelta, region.span.longitudeDelta},
                 _mapView.camera.pitch,
                 _mapView.camera.heading)];
}

// Animated where it can be seen.
- (BOOL)animates {
  return _mapView.window != nil;
}

- (void)moveCamera:(const std::optional<ngn::MapCamera> &)camera {
  if (camera) {
    [_mapView setRegion:regionFor(*camera) animated:[self animates]];
    return;
  }
  CLLocation *user = _mapView.showsUserLocation ? _mapView.userLocation.location : nil;
  if (user != nil) {
    [_mapView setCenterCoordinate:user.coordinate animated:[self animates]];
  }
}

- (void)selectMarker:(const std::optional<std::string> &)markerId zoom:(std::optional<double>)zoom moveCamera:(bool)moveCamera {
  if (!markerId) {
    for (id<MKAnnotation> selected in [_mapView.selectedAnnotations copy]) {
      [_mapView deselectAnnotation:selected animated:[self animates]];
    }
    return;
  }
  for (id<MKAnnotation> annotation in _mapView.annotations) {
    if (![annotation isKindOfClass:NGNMapMarker.class]) {
      continue;
    }
    auto index = ((NGNMapMarker *)annotation).index;
    if (index >= _model.markers.size() || _model.markers[index].id != *markerId) {
      continue;
    }
    if (moveCamera) {
      if (zoom) {
        [_mapView setRegion:regionFor({_model.markers[index].coordinates, *zoom}) animated:[self animates]];
      } else {
        [_mapView setCenterCoordinate:annotation.coordinate animated:[self animates]];
      }
    }
    [_mapView selectAnnotation:annotation animated:[self animates]];
    return;
  }
}

- (void)clicked:(NSClickGestureRecognizer *)recognizer {
  [self clickAt:[recognizer locationInView:_mapView]];
}

- (void)clickAt:(NSPoint)point {
  for (id<MKAnnotation> annotation in _mapView.annotations) {
    if (![annotation isKindOfClass:NGNMapMarker.class]) {
      continue;
    }
    NSPoint tip = [_mapView convertCoordinate:annotation.coordinate toPointToView:_mapView];
    CGFloat top = _mapView.isFlipped ? tip.y - kMarkerHeight : tip.y;
    if (NSPointInRect(point, NSMakeRect(tip.x - kMarkerWidth / 2, top, kMarkerWidth, kMarkerHeight))) {
      return;
    }
  }
  CLLocationCoordinate2D tap = [_mapView convertPoint:point toCoordinateFromView:_mapView];
  [self send:ngn::mapClickAt(_model, {tap.latitude, tap.longitude})];
}

#pragma mark MKMapViewDelegate

- (void)mapView:(MKMapView *)mapView regionDidChangeAnimated:(BOOL)animated {
  [self reportCamera];
}

- (void)mapView:(MKMapView *)mapView didSelectAnnotationView:(MKAnnotationView *)view {
  if (![view.annotation isKindOfClass:NGNMapMarker.class]) {
    return;
  }
  auto index = ((NGNMapMarker *)view.annotation).index;
  if (index < _model.markers.size()) {
    [self send:ngn::mapMarkerClick(_model.markers[index])];
  }
}

- (MKAnnotationView *)mapView:(MKMapView *)mapView viewForAnnotation:(id<MKAnnotation>)annotation {
  if (![annotation isKindOfClass:NGNMapMarker.class]) {
    return nil;
  }
  auto index = ((NGNMapMarker *)annotation).index;
  if (index >= _model.markers.size()) {
    return nil;
  }
  const auto &marker = _model.markers[index];
  auto *view = (MKMarkerAnnotationView *)[mapView dequeueReusableAnnotationViewWithIdentifier:@"marker"];
  if (view == nil) {
    view = [[MKMarkerAnnotationView alloc] initWithAnnotation:annotation reuseIdentifier:@"marker"];
  }
  view.annotation = annotation;
  view.markerTintColor = NGNMapColor(marker.tint, NSColor.systemRedColor);
  view.glyphImage = marker.systemImage.empty() ? nil : [NSImage imageWithSystemSymbolName:string(marker.systemImage) accessibilityDescription:nil];
  view.glyphText = !marker.monogram.empty() && marker.systemImage.empty() ? string(marker.monogram) : nil;
  return view;
}

- (MKOverlayRenderer *)mapView:(MKMapView *)mapView rendererForOverlay:(id<MKOverlay>)overlay {
  NSArray<NSString *> *parts = [overlay.title componentsSeparatedByString:@":"];
  if (parts.count != 2) {
    return [[MKOverlayRenderer alloc] initWithOverlay:overlay];
  }
  auto index = static_cast<size_t>(parts[1].integerValue);
  if ([parts[0] isEqualToString:@"polyline"] && index < _model.polylines.size()) {
    const auto &line = _model.polylines[index];
    auto *renderer = [[MKPolylineRenderer alloc] initWithPolyline:(MKPolyline *)overlay];
    renderer.strokeColor = NGNMapColor(line.color, NSColor.systemBlueColor);
    renderer.lineWidth = line.width;
    return renderer;
  }
  if ([parts[0] isEqualToString:@"polygon"] && index < _model.polygons.size()) {
    const auto &polygon = _model.polygons[index];
    auto *renderer = [[MKPolygonRenderer alloc] initWithPolygon:(MKPolygon *)overlay];
    renderer.fillColor = NGNMapColor(polygon.color, NSColor.systemBlueColor);
    renderer.strokeColor = NGNMapColor(polygon.lineColor, NSColor.clearColor);
    renderer.lineWidth = polygon.lineWidth;
    return renderer;
  }
  if ([parts[0] isEqualToString:@"circle"] && index < _model.circles.size()) {
    const auto &circle = _model.circles[index];
    auto *renderer = [[MKCircleRenderer alloc] initWithCircle:(MKCircle *)overlay];
    renderer.fillColor = NGNMapColor(circle.color, NSColor.systemGreenColor);
    renderer.strokeColor = NGNMapColor(circle.lineColor, NSColor.clearColor);
    renderer.lineWidth = circle.lineWidth;
    return renderer;
  }
  return [[MKOverlayRenderer alloc] initWithOverlay:overlay];
}

@end
