#import "host-view.h"

#import "header-toolbar.h"
#import "image-view.h"
#import "modal-host-view.h"
#import "native-controls.h"
#import "scroll-view.h"

#include "text-layout.h"

#include <react/renderer/components/iostextinput/TextInputProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>
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

NSString *nsString(const std::string &s) {
  NSString *result = [NSString stringWithUTF8String:s.c_str()];
  return result != nil ? result : @"";
}

} // namespace

#pragma mark - NGNView

@implementation NGNView {
  Props::Shared _props;
  LayoutMetrics _layout;
  State::Shared _state;
  EventEmitter::Shared _emitter;
  ngn::DesktopProps _desktop;
  BOOL _focusVisible;
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

- (const ngn::DesktopProps &)desktopProps {
  return _desktop;
}

- (NSView *)contentContainer {
  return self;
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
  layer.backgroundColor = nsColor(viewProps->backgroundColor).CGColor;
  self.alphaValue = viewProps->opacity;
  // One radius, width and colour for now; per-corner and per-side drawing comes with the
  // CSS-engine parity work.
  auto border = viewProps->resolveBorderMetrics(_layout);
  layer.cornerRadius = border.borderRadii.topLeft.horizontal;
  layer.borderWidth = border.borderWidths.left;
  layer.borderColor = nsColor(border.borderColors.left).CGColor;
  layer.masksToBounds = viewProps->yogaStyle.overflow() != facebook::yoga::Overflow::Visible;
}

- (void)drawRect:(NSRect)dirtyRect {
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
  if (name == "RNSScreenStackHeaderConfig") {
    return [[NGNHeaderConfigView alloc] initWithShadowView:view];
  }
  if (name == "RNSScreenStackHeaderSubview") {
    return [[NGNHeaderSubviewView alloc] initWithShadowView:view];
  }
  if (name == "ScrollView") {
    return [[NGNScrollView alloc] initWithShadowView:view];
  }
  return [[NGNView alloc] initWithShadowView:view];
}
