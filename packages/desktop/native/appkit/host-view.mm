#import "host-view.h"

#import <QuartzCore/QuartzCore.h>

#import "cg-canvas.h"
#import "header-toolbar.h"
#import "image-view.h"
#import "modal-host-view.h"
#import "native-controls.h"
#import "presented-screen.h"
#import "scroll-view.h"
#import "split-view.h"
#import "svg-view.h"
#import "symbol-view.h"
#import "web-view-component.h"
#import "expo-image-view.h"
#import "camera-view.h"

#include "text-layout.h"

#include "ngn/accessibility.h"
#include "ngn/symbol.h"
#include "ngn/view-box.h"

#include <react/renderer/components/iostextinput/TextInputProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {

NSColor *nsColor(const SharedColor &color) {
  if (!color) {
    return nil;
  }
  auto c = colorComponentsFromColor(color);
  return [NSColor colorWithSRGBRed:c.red green:c.green blue:c.blue alpha:c.alpha];
}

CGColorRef cgColor(uint32_t argb) {
  return [NSColor colorWithSRGBRed:((argb >> 16) & 0xff) / 255.0
                             green:((argb >> 8) & 0xff) / 255.0
                              blue:(argb & 0xff) / 255.0
                             alpha:(argb >> 24) / 255.0]
      .CGColor;
}

// A mask layer over `bounds` showing `path`.
CAShapeLayer *shapeLayer(const ngn::SvgPath &path, BOOL evenOdd, NSRect bounds) {
  CAShapeLayer *mask = [CAShapeLayer layer];
  mask.frame = bounds;
  CGPathRef p = NGNCreatePath(path);
  mask.path = p;
  CGPathRelease(p);
  mask.fillRule = evenOdd ? kCAFillRuleEvenOdd : kCAFillRuleNonZero;
  return mask;
}

NSString *nsString(const std::string &s) {
  NSString *result = [NSString stringWithUTF8String:s.c_str()];
  return result != nil ? result : @"";
}

NSAccessibilityRole nsRole(ngn::AxRole role) {
  switch (role) {
    case ngn::AxRole::Group:
      return NSAccessibilityGroupRole;
    case ngn::AxRole::Button:
      return NSAccessibilityButtonRole;
    case ngn::AxRole::Link:
      return NSAccessibilityLinkRole;
    case ngn::AxRole::Image:
      return NSAccessibilityImageRole;
    case ngn::AxRole::StaticText:
      return NSAccessibilityStaticTextRole;
    case ngn::AxRole::CheckBox:
      return NSAccessibilityCheckBoxRole;
    case ngn::AxRole::RadioButton:
      return NSAccessibilityRadioButtonRole;
    case ngn::AxRole::RadioGroup:
      return NSAccessibilityRadioGroupRole;
    case ngn::AxRole::Slider:
      return NSAccessibilitySliderRole;
    case ngn::AxRole::TextField:
      return NSAccessibilityTextFieldRole;
    case ngn::AxRole::List:
      return NSAccessibilityListRole;
    case ngn::AxRole::Menu:
      return NSAccessibilityMenuRole;
    case ngn::AxRole::MenuItem:
      return NSAccessibilityMenuItemRole;
    case ngn::AxRole::MenuBar:
      return NSAccessibilityMenuBarRole;
    case ngn::AxRole::ProgressIndicator:
      return NSAccessibilityProgressIndicatorRole;
    case ngn::AxRole::ComboBox:
      return NSAccessibilityComboBoxRole;
    case ngn::AxRole::TabGroup:
      return NSAccessibilityTabGroupRole;
    case ngn::AxRole::Toolbar:
      return NSAccessibilityToolbarRole;
    case ngn::AxRole::ScrollBar:
      return NSAccessibilityScrollBarRole;
    case ngn::AxRole::Table:
      return NSAccessibilityTableRole;
    case ngn::AxRole::Row:
      return NSAccessibilityRowRole;
    case ngn::AxRole::Cell:
      return NSAccessibilityCellRole;
    case ngn::AxRole::Incrementor:
      return NSAccessibilityIncrementorRole;
    case ngn::AxRole::Heading:
      if (@available(macOS 26, *)) {
        return NSAccessibilityHeadingRole;
      }
      return NSAccessibilityGroupRole;
    case ngn::AxRole::LevelIndicator:
      return NSAccessibilityLevelIndicatorRole;
    case ngn::AxRole::Outline:
      return NSAccessibilityOutlineRole;
    case ngn::AxRole::ScrollArea:
      return NSAccessibilityScrollAreaRole;
  }
  return NSAccessibilityGroupRole;
}

// Whether AppKit has a role of its own for this one, so its own name for it is spoken.
bool nativeRole(ngn::AxRole role) {
  if (role == ngn::AxRole::Heading) {
    if (@available(macOS 26, *)) {
      return true;
    }
    return false;
  }
  return true;
}

NSAccessibilitySubrole nsSubrole(ngn::AxSubrole subrole) {
  switch (subrole) {
    case ngn::AxSubrole::Switch:
      return NSAccessibilitySwitchSubrole;
    case ngn::AxSubrole::Toggle:
      return NSAccessibilityToggleSubrole;
    case ngn::AxSubrole::Tab:
      return NSAccessibilityTabButtonSubrole;
    case ngn::AxSubrole::SearchField:
      return NSAccessibilitySearchFieldSubrole;
    case ngn::AxSubrole::OutlineRow:
      return NSAccessibilityOutlineRowSubrole;
    case ngn::AxSubrole::None:
      return nil;
  }
  return nil;
}

} // namespace

#pragma mark - NGNView

static ngn::InputDispatcher *gViewInput;

@implementation NGNView {
  Props::Shared _props;
  LayoutMetrics _layout;
  State::Shared _state;
  EventEmitter::Shared _emitter;
  ngn::DesktopProps _desktop;
  BOOL _focusVisible;
  // drawRect draws the box (ngn/view-box.h), which the layer does not.
  BOOL _boxDrawn;
  NSMutableArray<CALayer *> *_shadowLayers;
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithFrame:NSZeroRect])) {
    _reactTag = view.tag;
    _surfaceId = view.surfaceId;
    _componentName = [NSString stringWithUTF8String:view.componentName];
    self.wantsLayer = YES;
    self.layerContentsRedrawPolicy = NSViewLayerContentsRedrawOnSetNeedsDisplay;
  }
  return self;
}

+ (ngn::InputDispatcher *)activator {
  return gViewInput;
}
+ (void)setActivator:(ngn::InputDispatcher *)input {
  gViewInput = input;
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)acceptsFirstResponder {
  return _desktop.focusable.value_or(false) || _desktop.tabIndex.value_or(-1) >= 0;
}


// Whether the event AppKit is handling is a key's: a focus a key moved draws a ring and matches
// `:focus-visible`, which the engine learns from `focusVisible` on the focus event.
static BOOL focusFromKeyboard() {
  NSEventType type = NSApp.currentEvent.type;
  return type == NSEventTypeKeyDown || type == NSEventTypeKeyUp;
}

- (BOOL)becomeFirstResponder {
  if (![super becomeFirstResponder]) {
    return NO;
  }
  _focusVisible = focusFromKeyboard();
  self.focusRingType = _focusVisible ? NSFocusRingTypeDefault : NSFocusRingTypeNone;
  [self noteFocusRingMaskChanged];
  if (_emitter) {
    _emitter->dispatchEvent("focus", folly::dynamic::object("target", (int)_reactTag)("focusVisible", (bool)_focusVisible));
  }
  return YES;
}

- (BOOL)resignFirstResponder {
  if (![super resignFirstResponder]) {
    return NO;
  }
  _focusVisible = NO;
  [self noteFocusRingMaskChanged];
  if (_emitter) {
    _emitter->dispatchEvent("blur", folly::dynamic::object("target", (int)_reactTag));
  }
  return YES;
}

// AppKit's focus ring, in the view's shape, while the focus came from the keyboard. An app that
// styles `outline` draws its own.
- (void)drawFocusRingMask {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  CGFloat radius = viewProps ? viewProps->resolveBorderMetrics(_layout).borderRadii.topLeft.horizontal : 0;
  [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:radius yRadius:radius] fill];
}

- (NSRect)focusRingMaskBounds {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  BOOL ownOutline = viewProps && (viewProps->outlineWidth > 0 || viewProps->outlineColor);
  return _focusVisible && !ownOutline ? self.bounds : NSZeroRect;
}

- (EventEmitter::Shared)eventEmitter {
  return _emitter;
}

- (Props::Shared)props {
  return _props;
}

- (State::Shared)state {
  return _state;
}

- (const LayoutMetrics &)layoutMetrics {
  return _layout;
}

- (const ngn::DesktopProps &)desktopProps {
  return _desktop;
}

- (NSView *)contentContainer {
  return self;
}

- (NSResponder *)keyboardResponder {
  return self;
}

#pragma mark Accessibility

// React Native's accessibility props, mapped in the core (accessibility.h).
- (ngn::AxInfo)axInfo {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  if (!viewProps) {
    return ngn::AxInfo{};
  }
  if ([_componentName isEqualToString:@"Paragraph"]) {
    return ngn::paragraphAccessibilityInfo(*viewProps, ngn::paragraphText(_state));
  }
  return ngn::accessibilityInfo(*viewProps);
}

- (BOOL)isAccessibilityElement {
  return [self axInfo].element;
}

- (NSAccessibilityRole)accessibilityRole {
  return nsRole([self axInfo].role);
}

- (NSAccessibilitySubrole)accessibilitySubrole {
  return nsSubrole([self axInfo].subrole);
}

- (NSString *)accessibilityRoleDescription {
  auto info = [self axInfo];
  // A role AppKit has (a heading from macOS 26) is spoken by AppKit's own name for it.
  if (!info.roleDescription.empty() && !(info.role == ngn::AxRole::Heading && nativeRole(info.role))) {
    return nsString(info.roleDescription);
  }
  return NSAccessibilityRoleDescription(nsRole(info.role), nsSubrole(info.subrole));
}

- (NSString *)accessibilityLabel {
  auto info = [self axInfo];
  if (info.label.empty() && info.hidesChildren && ![_componentName isEqualToString:@"Paragraph"]) {
    // Read as one element with no label of its own: named by the text inside it, as iOS does.
    NSMutableArray<NSString *> *texts = [NSMutableArray array];
    [self collectTextInto:texts];
    return texts.count > 0 ? [texts componentsJoinedByString:@" "] : nil;
  }
  return info.label.empty() ? nil : nsString(info.label);
}

- (void)collectTextInto:(NSMutableArray<NSString *> *)texts {
  for (NSView *child in [self contentContainer].subviews) {
    if (![child isKindOfClass:NGNView.class] || child.hidden) {
      continue;
    }
    NGNView *view = (NGNView *)child;
    auto info = [view axInfo];
    if (!info.label.empty()) {
      [texts addObject:nsString(info.label)];
    } else if ([view.componentName isEqualToString:@"Paragraph"]) {
      auto text = ngn::paragraphText(view.state);
      if (!text.empty()) {
        [texts addObject:nsString(text)];
      }
    } else {
      [view collectTextInto:texts];
    }
  }
}

// An element read as one has no elements inside it.
- (NSArray *)accessibilityChildren {
  if ([self axInfo].hidesChildren) {
    return @[];
  }
  return [super accessibilityChildren];
}

- (NSString *)accessibilityHelp {
  auto info = [self axInfo];
  return info.hint.empty() ? nil : nsString(info.hint);
}

- (id)accessibilityValue {
  auto info = [self axInfo];
  if (info.checked) {
    return @(*info.checked);
  }
  return info.value.empty() ? nil : nsString(info.value);
}

// The heading level, which AppKit names from macOS 26 and has no property for.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
- (NSArray<NSAccessibilityAttributeName> *)accessibilityAttributeNames {
  NSArray *names = [super accessibilityAttributeNames];
  auto info = [self axInfo];
  if (info.level && nativeRole(info.role) && info.role == ngn::AxRole::Heading) {
    return [names arrayByAddingObject:@"AXHeadingLevel"];
  }
  return names;
}

- (id)accessibilityAttributeValue:(NSAccessibilityAttributeName)attribute {
  if ([attribute isEqualToString:@"AXHeadingLevel"]) {
    auto level = [self axInfo].level;
    return level ? @(*level) : nil;
  }
  return [super accessibilityAttributeValue:attribute];
}
#pragma clang diagnostic pop

- (BOOL)isAccessibilityEnabled {
  return ![self axInfo].disabled;
}

- (BOOL)isAccessibilitySelected {
  return [self axInfo].selected;
}

- (BOOL)isAccessibilityExpanded {
  return [self axInfo].expanded.value_or(false);
}

- (NSArray<NSAccessibilityCustomAction *> *)accessibilityCustomActions {
  auto info = [self axInfo];
  if (info.customActions.empty()) {
    return nil;
  }
  NSMutableArray<NSAccessibilityCustomAction *> *actions = [NSMutableArray array];
  __weak NGNView *weakSelf = self;
  for (const auto &action : info.customActions) {
    std::string name = action.name;
    [actions addObject:[[NSAccessibilityCustomAction alloc] initWithName:nsString(action.label)
                                                                 handler:^BOOL {
                                                                   return [weakSelf sendAccessibilityAction:name];
                                                                 }]];
  }
  return actions;
}

// Sends a declared action, as iOS does only to a view that listens for them.
- (BOOL)sendAccessibilityAction:(const std::string &)name {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  auto emitter = std::dynamic_pointer_cast<const ViewEventEmitter>(_emitter);
  if (!viewProps || !viewProps->onAccessibilityAction || !emitter) {
    return NO;
  }
  emitter->onAccessibilityAction(name);
  return YES;
}

// One of AppKit's standard actions, as the core decides it reaches the app (accessibility.h).
- (BOOL)performAxVerb:(ngn::AxVerb)verb {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  auto emitter = std::dynamic_pointer_cast<const ViewEventEmitter>(_emitter);
  if (!viewProps || !emitter) {
    return NO;
  }
  auto dispatch = ngn::axDispatch(*viewProps, verb);
  switch (dispatch.kind) {
    case ngn::AxDispatch::Kind::None:
      return NO;
    case ngn::AxDispatch::Kind::Tap:
      emitter->onAccessibilityTap();
      return YES;
    case ngn::AxDispatch::Kind::Escape:
      emitter->onAccessibilityEscape();
      return YES;
    case ngn::AxDispatch::Kind::Action:
      emitter->onAccessibilityAction(dispatch.action);
      return YES;
    case ngn::AxDispatch::Kind::Click:
      return gViewInput != nullptr && gViewInput->activate(static_cast<SurfaceId>(_surfaceId), static_cast<Tag>(_reactTag));
  }
  return NO;
}

- (BOOL)accessibilityPerformPress {
  return [self performAxVerb:ngn::AxVerb::Press];
}

- (BOOL)accessibilityPerformIncrement {
  return [self performAxVerb:ngn::AxVerb::Increment];
}

- (BOOL)accessibilityPerformDecrement {
  return [self performAxVerb:ngn::AxVerb::Decrement];
}

- (BOOL)accessibilityPerformCancel {
  return [self performAxVerb:ngn::AxVerb::Cancel];
}

// AppKit lists an action for every one of these the class implements; a view offers only those
// that mean something for it. A focusable view is pressed as a control is.
- (BOOL)isAccessibilitySelectorAllowed:(SEL)selector {
  if (selector == @selector(accessibilityPerformPress)) {
    return [self axInfo].offersPress || [self acceptsFirstResponder];
  }
  if (selector == @selector(accessibilityPerformIncrement) || selector == @selector(accessibilityPerformDecrement)) {
    return [self axInfo].offersIncrement;
  }
  if (selector == @selector(accessibilityPerformCancel)) {
    return [self axInfo].offersCancel;
  }
  // Only a view that expands says whether it is expanded.
  if (selector == @selector(isAccessibilityExpanded)) {
    return [self axInfo].expanded.has_value();
  }
  return [super isAccessibilitySelectorAllowed:selector];
}

// Space and Return press a focused view, as they press a focused AppKit control. A default button
// takes Return first, as AppKit's own key equivalents do.
- (void)keyDown:(NSEvent *)event {
  NSEventModifierFlags modifiers = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl |
                                                          NSEventModifierFlagOption);
  NSString *key = event.charactersIgnoringModifiers;
  BOOL activates = [key isEqualToString:@" "] || [key isEqualToString:@"\r"];
  if (modifiers == 0 && activates && !event.isARepeat && self.window.firstResponder == self &&
      [self performAxVerb:ngn::AxVerb::Press]) {
    return;
  }
  [super keyDown:event];
}

- (void)updateProps:(const Props::Shared &)props {
  _props = props;
  [self applyVisuals];
  if ([_componentName isEqualToString:@"Paragraph"]) {
    [self setNeedsDisplay:YES];
  }
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  _layout = metrics;
  const auto &f = metrics.frame;
  self.frame = NSMakeRect(f.origin.x, f.origin.y, f.size.width, f.size.height);
  self.hidden = metrics.displayType == DisplayType::None || _covered;
  [self applyVisuals];
  [self setNeedsDisplay:YES];
}

- (void)setCovered:(BOOL)covered {
  _covered = covered;
  self.hidden = _layout.displayType == DisplayType::None || covered;
}

- (void)updateState:(const State::Shared &)state {
  _state = state;
  [self setNeedsDisplay:YES];
}

- (void)updateEventEmitter:(const EventEmitter::Shared &)emitter {
  _emitter = emitter;
}

- (void)updateDesktopProps:(const ngn::DesktopProps &)props {
  // Kept for the Tab-order walk; focusable already decides acceptsFirstResponder.
  _desktop = props;
}

- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args {
}

- (void)applyVisuals {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  if (!viewProps) {
    return;
  }
  CALayer *layer = self.layer;
  self.alphaValue = viewProps->opacity;
  auto box = ngn::viewBox(*viewProps, _layout);
  layer.backgroundColor = box.background ? cgColor(*box.background) : nil;
  layer.cornerRadius = box.cornerRadius;
  layer.borderWidth = box.borderWidth;
  layer.borderColor = box.borderColor ? cgColor(*box.borderColor) : nil;
  layer.masksToBounds = viewProps->yogaStyle.overflow() != facebook::yoga::Overflow::Visible;
  layer.mask = box.clip ? shapeLayer(*box.clip, NO, self.bounds) : nil;
  [self applyShadows:box.shadows];
  if (box.drawn || _boxDrawn) {
    [self setNeedsDisplay:YES];
  }
  _boxDrawn = box.drawn;
}

// Each box shadow as a layer under the children, as RCTViewComponentView adds them.
- (void)applyShadows:(const std::vector<ngn::BoxShadowLayer> &)shadows {
  for (CALayer *old in _shadowLayers) {
    [old removeFromSuperlayer];
  }
  [_shadowLayers removeAllObjects];
  if (shadows.empty()) {
    return;
  }
  if (_shadowLayers == nil) {
    _shadowLayers = [NSMutableArray array];
  }
  for (const auto &shadow : shadows) {
    CALayer *layer = [CALayer layer];
    layer.frame = self.bounds;
    layer.zPosition = -1000;
    layer.shadowColor = cgColor(shadow.argb);
    layer.shadowOpacity = 1;
    layer.shadowOffset = CGSizeZero;
    layer.shadowRadius = shadow.radius;
    CGPathRef path = NGNCreatePath(shadow.shadowPath);
    layer.shadowPath = path;
    CGPathRelease(path);
    layer.mask = shapeLayer(shadow.mask, shadow.maskEvenOdd, self.bounds);
    [self.layer addSublayer:layer];
    [_shadowLayers addObject:layer];
  }
}

- (void)drawRect:(NSRect)dirtyRect {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(_props);
  if (_boxDrawn && viewProps) {
    CGContextRef context = NSGraphicsContext.currentContext.CGContext;
    CGFloat scale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
    auto canvas = NGNMakeCGCanvas(context, self.bounds.size, scale, nil);
    CGContextSaveGState(context);
    ngn::drawViewBox(*viewProps, _layout, *canvas);
    CGContextRestoreGState(context);
  }
  if (![_componentName isEqualToString:@"Paragraph"] || !_state) {
    return;
  }
  auto state = std::static_pointer_cast<const ConcreteState<ParagraphState>>(_state);
  const auto &data = state->getData();
  const auto &insets = _layout.contentInsets;
  CGFloat width = _layout.frame.size.width - insets.left - insets.right;
  // A hair of slack, so the width Yoga rounded to the pixel lays out the same lines as measure.
  auto layout = ngn::layoutText(data.attributedString, data.paragraphAttributes, width + 0.5);
  ngn::drawText(layout, NSGraphicsContext.currentContext.CGContext, CGPointMake(insets.left, insets.top), width);
}

@end

#pragma mark - NGNTextInputView

@implementation NGNTextInputView {
  NSTextField *_field;
  int _eventCount;
  BOOL _settingText;
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    // Secure entry is a field of its own class in AppKit, chosen as the view is made.
    auto first = std::dynamic_pointer_cast<const TextInputProps>(view.props);
    BOOL secure = first && first->traits.secureTextEntry;
    _field = secure ? [[NSSecureTextField alloc] initWithFrame:NSZeroRect] : [[NSTextField alloc] initWithFrame:NSZeroRect];
    _field.bezeled = NO;
    _field.bordered = NO;
    _field.drawsBackground = NO;
    _field.focusRingType = NSFocusRingTypeNone;
    _field.usesSingleLineMode = YES;
    _field.cell.scrollable = YES;
    _field.cell.wraps = NO;
    _field.delegate = self;
    [self addSubview:_field];
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  auto p = std::dynamic_pointer_cast<const TextInputProps>(props);
  if (!p) {
    return;
  }
  auto attrs = p->getEffectiveTextAttributes(1);
  AttributedString probe;
  probe.appendFragment(AttributedString::Fragment{.string = "x", .textAttributes = attrs, .parentShadowView = {}});
  CFAttributedStringRef s = ngn::makeAttributedString(probe);
  CTFontRef font = (CTFontRef)CFAttributedStringGetAttribute(s, 0, kCTFontAttributeName, nullptr);
  _field.font = (__bridge NSFont *)font;
  CFRelease(s);
  _field.textColor = attrs.foregroundColor ? nsColor(attrs.foregroundColor) : NSColor.textColor;
  _field.placeholderString = nsString(p->placeholder);
  _field.editable = p->editable;
  // The text prop wins only when it is not older than what the field has sent (React Native iOS's
  // rule), and never while an input method is composing.
  if (p->mostRecentEventCount >= _eventCount && !p->text.empty() && ![self composing]) {
    NSString *text = nsString(p->text);
    if (![_field.stringValue isEqualToString:text]) {
      _field.stringValue = text;
    }
  }
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  const auto &i = metrics.contentInsets;
  NSRect content = NSMakeRect(
      i.left, i.top, metrics.frame.size.width - i.left - i.right, metrics.frame.size.height - i.top - i.bottom);
  // The single line, centred vertically in the content box.
  CGFloat h = std::min<CGFloat>(content.size.height, _field.intrinsicContentSize.height);
  _field.frame = NSMakeRect(content.origin.x, content.origin.y + (content.size.height - h) / 2, content.size.width, h);
}

- (NSResponder *)keyboardResponder {
  return _field;
}

- (BOOL)composing {
  NSText *editor = _field.currentEditor;
  return [editor isKindOfClass:NSTextView.class] && [(NSTextView *)editor hasMarkedText];
}

- (TextInputEventEmitter::Metrics)metrics {
  NSRange sel = _field.currentEditor ? _field.currentEditor.selectedRange : NSMakeRange(_field.stringValue.length, 0);
  return TextInputEventEmitter::Metrics{
      .text = std::string(_field.stringValue.UTF8String),
      .selectionRange = {.location = (int)sel.location, .length = (int)sel.length},
      .eventCount = _eventCount,
      .target = (Tag)self.reactTag,
  };
}

- (std::shared_ptr<const TextInputEventEmitter>)inputEmitter {
  return std::static_pointer_cast<const TextInputEventEmitter>(self.eventEmitter);
}

- (void)controlTextDidChange:(NSNotification *)note {
  if (_settingText) {
    return;
  }
  _eventCount++;
  if (auto e = [self inputEmitter]) {
    e->onChange([self metrics]);
  }
}

- (void)controlTextDidBeginEditing:(NSNotification *)note {
  NSTextView *editor = note.userInfo[@"NSFieldEditor"];
  if (editor != nil) {
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(selectionDidChange:)
                                               name:NSTextViewDidChangeSelectionNotification
                                             object:editor];
  }
}

- (void)controlTextDidEndEditing:(NSNotification *)note {
  [NSNotificationCenter.defaultCenter removeObserver:self name:NSTextViewDidChangeSelectionNotification object:nil];
  if (auto e = [self inputEmitter]) {
    e->onEndEditing([self metrics]);
    e->onBlur([self metrics]);
  }
}

- (void)selectionDidChange:(NSNotification *)note {
  if (auto e = [self inputEmitter]) {
    e->onSelectionChange([self metrics]);
  }
}

- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)selector {
  if (selector == @selector(insertNewline:)) {
    if (auto e = [self inputEmitter]) {
      e->onSubmitEditing([self metrics]);
    }
    return YES;
  }
  return NO;
}

- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args {
  if (name == "focus") {
    [self.window makeFirstResponder:_field];
    if (auto e = [self inputEmitter]) {
      e->onFocus([self metrics]);
    }
  } else if (name == "blur") {
    [self.window makeFirstResponder:nil];
  } else if (name == "setTextAndSelection" && args.isArray() && args.size() >= 4) {
    int count = (int)args[0].asInt();
    if (count < _eventCount) {
      return; // stale: the field has moved on since JavaScript sent this
    }
    if (args[1].isString() && ![self composing]) {
      NSString *text = nsString(args[1].asString());
      if (![_field.stringValue isEqualToString:text]) {
        _settingText = YES;
        _field.stringValue = text;
        _settingText = NO;
      }
    }
    if (args[2].isNumber() && args[3].isNumber() && _field.currentEditor) {
      NSInteger start = args[2].asInt(), end = args[3].asInt();
      if (start >= 0 && end >= start && (NSUInteger)end <= _field.stringValue.length) {
        _field.currentEditor.selectedRange = NSMakeRange(start, end - start);
      }
    }
  }
}

@end

#pragma mark - NGNMultilineTextInputView

// A multiline TextInput: an NSTextView, which wraps, scrolls and takes Return as a new line.
@interface NGNMultilineTextInputView : NGNView <NSTextViewDelegate>
@end

@implementation NGNMultilineTextInputView {
  NSScrollView *_scroll;
  NSTextView *_text;
  int _eventCount;
  BOOL _settingText;
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _scroll = [[NSScrollView alloc] initWithFrame:NSZeroRect];
    _scroll.drawsBackground = NO;
    _scroll.hasVerticalScroller = YES;
    _scroll.autohidesScrollers = YES;
    _text = [[NSTextView alloc] initWithFrame:NSZeroRect];
    _text.drawsBackground = NO;
    _text.richText = NO;
    _text.allowsUndo = YES;
    _text.verticallyResizable = YES;
    _text.horizontallyResizable = NO;
    _text.autoresizingMask = NSViewWidthSizable;
    _text.textContainer.widthTracksTextView = YES;
    _text.textContainerInset = NSZeroSize;
    _text.textContainer.lineFragmentPadding = 0;
    _text.delegate = self;
    _scroll.documentView = _text;
    [self addSubview:_scroll];
  }
  return self;
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  auto p = std::dynamic_pointer_cast<const TextInputProps>(props);
  if (!p) {
    return;
  }
  auto attrs = p->getEffectiveTextAttributes(1);
  AttributedString probe;
  probe.appendFragment(AttributedString::Fragment{.string = "x", .textAttributes = attrs, .parentShadowView = {}});
  CFAttributedStringRef s = ngn::makeAttributedString(probe);
  CTFontRef font = (CTFontRef)CFAttributedStringGetAttribute(s, 0, kCTFontAttributeName, nullptr);
  _text.font = (__bridge NSFont *)font;
  CFRelease(s);
  _text.textColor = attrs.foregroundColor ? nsColor(attrs.foregroundColor) : NSColor.textColor;
  _text.editable = p->editable;
  if (p->mostRecentEventCount >= _eventCount && !p->text.empty() && !_text.hasMarkedText) {
    NSString *text = nsString(p->text);
    if (![_text.string isEqualToString:text]) {
      _settingText = YES;
      _text.string = text;
      _settingText = NO;
    }
  }
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  const auto &i = metrics.contentInsets;
  _scroll.frame = NSMakeRect(
      i.left, i.top, metrics.frame.size.width - i.left - i.right, metrics.frame.size.height - i.top - i.bottom);
  _text.frame = NSMakeRect(0, 0, _scroll.contentSize.width, std::max(_text.frame.size.height, _scroll.contentSize.height));
}

- (NSResponder *)keyboardResponder {
  return _text;
}

- (TextInputEventEmitter::Metrics)metrics {
  NSRange sel = _text.selectedRange;
  return TextInputEventEmitter::Metrics{
      .text = std::string(_text.string.UTF8String),
      .selectionRange = {.location = (int)sel.location, .length = (int)sel.length},
      .eventCount = _eventCount,
      .target = (Tag)self.reactTag,
  };
}

- (std::shared_ptr<const TextInputEventEmitter>)inputEmitter {
  return std::static_pointer_cast<const TextInputEventEmitter>(self.eventEmitter);
}

- (void)textDidChange:(NSNotification *)note {
  if (_settingText) {
    return;
  }
  _eventCount++;
  if (auto e = [self inputEmitter]) {
    e->onChange([self metrics]);
  }
}

- (void)textDidBeginEditing:(NSNotification *)note {
  if (auto e = [self inputEmitter]) {
    e->onFocus([self metrics]);
  }
}

- (void)textDidEndEditing:(NSNotification *)note {
  if (auto e = [self inputEmitter]) {
    e->onEndEditing([self metrics]);
    e->onBlur([self metrics]);
  }
}

- (void)textViewDidChangeSelection:(NSNotification *)note {
  if (auto e = [self inputEmitter]) {
    e->onSelectionChange([self metrics]);
  }
}

- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args {
  if (name == "focus") {
    [self.window makeFirstResponder:_text];
  } else if (name == "blur") {
    [self.window makeFirstResponder:nil];
  } else if (name == "setTextAndSelection" && args.isArray() && args.size() >= 4) {
    if ((int)args[0].asInt() < _eventCount) {
      return;
    }
    if (args[1].isString() && !_text.hasMarkedText) {
      NSString *text = nsString(args[1].asString());
      if (![_text.string isEqualToString:text]) {
        _settingText = YES;
        _text.string = text;
        _settingText = NO;
      }
    }
    if (args[2].isNumber() && args[3].isNumber()) {
      NSInteger start = args[2].asInt(), end = args[3].asInt();
      if (start >= 0 && end >= start && (NSUInteger)end <= _text.string.length) {
        _text.selectedRange = NSMakeRange(start, end - start);
      }
    }
  }
}

@end

// The libraries' views (component-view.h), by component name. Filled as the binary loads, before
// anything mounts, and read on the UI thread after.
static NSMutableDictionary<NSString *, Class> *libraryViews() {
  static NSMutableDictionary<NSString *, Class> *views = [NSMutableDictionary dictionary];
  return views;
}

void NGNRegisterComponentView(NSString *componentName, Class viewClass) {
  if (![viewClass isSubclassOfClass:NGNView.class]) {
    NSLog(@"[ngn] %@ is not an NGNView, so %@ mounts as a plain view", viewClass, componentName);
    return;
  }
  libraryViews()[componentName] = viewClass;
}

NGNView *NGNMakeView(const ShadowView &view) {
  if (NGNView *control = NGNMakeControlView(view)) {
    return control;
  }
  std::string_view name = view.componentName;
  if (name == "TextInput") {
    auto props = std::dynamic_pointer_cast<const TextInputProps>(view.props);
    if (props && props->multiline) {
      return [[NGNMultilineTextInputView alloc] initWithShadowView:view];
    }
    return [[NGNTextInputView alloc] initWithShadowView:view];
  }
  if (name == "Image") {
    return [[NGNImageView alloc] initWithShadowView:view];
  }
  if (name == "ModalHostView") {
    return [[NGNModalHostView alloc] initWithShadowView:view];
  }
  if (name == "RNSScreen") {
    return [[NGNPresentedScreenView alloc] initWithShadowView:view];
  }
  if (name == "RNSScreenStackHeaderConfig") {
    return [[NGNHeaderConfigView alloc] initWithShadowView:view];
  }
  if (name == "RNSScreenStackHeaderSubview") {
    return [[NGNHeaderSubviewView alloc] initWithShadowView:view];
  }
  if (name == "ScrollView") {
    return [[NGNScrollView alloc] initWithShadowView:view];
  }
  if (name == ngn::SplitViewComponentName) {
    return [[NGNSplitView alloc] initWithShadowView:view];
  }
  if (name == ngn::SidebarComponentName || name == ngn::SplitContentComponentName) {
    return [[NGNSplitPaneView alloc] initWithShadowView:view];
  }
  if (name == "RNSTabsHostIOS") {
    return [[NGNTabsHostView alloc] initWithShadowView:view];
  }
  if (name == "RNSTabsScreenIOS") {
    return [[NGNTabScreenView alloc] initWithShadowView:view];
  }
  if (name == ngn::SidebarSectionComponentName) {
    return [[NGNSidebarSectionView alloc] initWithShadowView:view];
  }
  if (name == ngn::SidebarItemComponentName) {
    return [[NGNSidebarItemView alloc] initWithShadowView:view];
  }
  if (name == ngn::SymbolComponentName) {
    return [[NGNSymbolView alloc] initWithShadowView:view];
  }
  // react-native-svg's: the svg draws its elements, whose own views are hidden.
  if (name == "RNSVGSvgView") {
    return [[NGNSvgView alloc] initWithShadowView:view];
  }
  if (name.starts_with("RNSVG")) {
    return [[NGNSvgElementView alloc] initWithShadowView:view];
  }
  if (name == ngn::CameraComponentName) {
    return [[NGNCameraView alloc] initWithShadowView:view];
  }
  if (name == ngn::ExpoImageComponentName) {
    return [[NGNExpoImageView alloc] initWithShadowView:view];
  }
  if (name == "RNCWebView") {
    return [[NGNWebView alloc] initWithShadowView:view];
  }
  if (Class library = libraryViews()[@(view.componentName)]) {
    return [[library alloc] initWithShadowView:view];
  }
  return [[NGNView alloc] initWithShadowView:view];
}
