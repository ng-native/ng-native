// The NSView every Fabric view mounts as: layer-backed, flipped, placed at Yoga's frame.
// A Paragraph draws its text with Core Text; a TextInput hosts a real NSTextField.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/desktop-view-props.h"

#include <react/renderer/mounting/ShadowView.h>

@interface NGNView : NSView
@property (nonatomic, readonly) NSInteger reactTag;
@property (nonatomic, readonly, copy) NSString *componentName;
- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view;
- (void)updateProps:(const facebook::react::Props::Shared &)props;
- (void)updateLayout:(const facebook::react::LayoutMetrics &)metrics;
- (void)updateState:(const facebook::react::State::Shared &)state;
- (void)updateEventEmitter:(const facebook::react::EventEmitter::Shared &)emitter;
- (void)updateDesktopProps:(const ngn::DesktopProps &)props;
- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args;
- (facebook::react::EventEmitter::Shared)eventEmitter;
@end

// Hosts a real NSTextField, so the field editor, NSTextInputClient and IME are AppKit's own.
@interface NGNTextInputView : NGNView <NSTextFieldDelegate>
@end

// The view for a component name: a text field for TextInput, a plain NGNView otherwise.
NGNView *NGNMakeView(const facebook::react::ShadowView &view);
