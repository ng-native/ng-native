#import <React/RCTComponentViewFactory.h>
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#import "NgNativeButtonMetrics.h"
#import "NgNativeButtonShadowNode.h"

using namespace facebook::react;

/**
 `<native-button>` on iOS: a UIButton drawn from a button configuration, the glass ones on iOS 26
 and later. `kind` picks the style (`default` the prominent one, `destructive` in red, `plain`
 borderless, anything else the plain push button), `controlSize` UIButton's own size with the
 metrics the shadow node measures with, and a tap sends `topButtonPress`.
 */
@interface NgNativeButtonComponentView : RCTViewComponentView
@end

static NSString *string(const std::string &value)
{
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding] ?: @"";
}

static UIButtonConfiguration *configurationForKind(NSString *kind)
{
  if ([kind isEqualToString:@"plain"]) {
    return [UIButtonConfiguration plainButtonConfiguration];
  }
  BOOL prominent = [kind isEqualToString:@"default"];
  if (@available(iOS 26.0, *)) {
    return prominent ? [UIButtonConfiguration prominentGlassButtonConfiguration]
                     : [UIButtonConfiguration glassButtonConfiguration];
  }
  return prominent ? [UIButtonConfiguration filledButtonConfiguration] : [UIButtonConfiguration grayButtonConfiguration];
}

@implementation NgNativeButtonComponentView {
  UIButton *_button;
}

+ (void)load
{
  // Registered before any surface asks for it: a name nothing registered draws as unimplemented.
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NgNativeButtonComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = NgNativeButtonShadowNode::defaultSharedProps();
    _button = [UIButton buttonWithType:UIButtonTypeSystem];
    __weak NgNativeButtonComponentView *weakSelf = self;
    [_button addAction:[UIAction actionWithHandler:^(__kindof UIAction *action) {
               [weakSelf ngn_sendPress];
             }]
        forControlEvents:UIControlEventPrimaryActionTriggered];
    self.contentView = _button;
    [self ngn_configureWith:static_cast<const NgNativeButtonProps &>(*_props)];
  }
  return self;
}

// VoiceOver reads the button, with the label and traits React Native sets on the element.
- (NSObject *)accessibilityElement
{
  return _button;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = static_cast<const NgNativeButtonProps &>(*props);
  const auto &previous = static_cast<const NgNativeButtonProps &>(*_props);
  BOOL changed = newProps.title != previous.title || newProps.kind != previous.kind ||
      newProps.controlSize != previous.controlSize || newProps.sfSymbol != previous.sfSymbol;
  [super updateProps:props oldProps:oldProps];
  if (changed) {
    [self ngn_configureWith:newProps];
  }
  _button.enabled = newProps.enabled;
}

- (void)ngn_configureWith:(const NgNativeButtonProps &)props
{
  NSString *kind = string(props.kind);
  NSString *controlSize = string(props.controlSize);
  UIButtonConfiguration *configuration = configurationForKind(kind);
  configuration.buttonSize = NgNativeButtonConfigurationSize(controlSize);
  configuration.contentInsets = NgNativeButtonInsets(controlSize);
  configuration.title = string(props.title);
  configuration.titleLineBreakMode = NSLineBreakByTruncatingTail;
  configuration.image = NgNativeButtonSymbol(string(props.sfSymbol), controlSize);
  configuration.imagePadding = NgNativeButtonImagePadding;
  UIFont *font = NgNativeButtonFont(controlSize);
  configuration.titleTextAttributesTransformer = ^NSDictionary<NSAttributedStringKey, id> *(
      NSDictionary<NSAttributedStringKey, id> *attributes) {
    NSMutableDictionary *withFont = [attributes mutableCopy];
    withFont[NSFontAttributeName] = font;
    return withFont;
  };
  if ([kind isEqualToString:@"destructive"]) {
    configuration.baseForegroundColor = UIColor.systemRedColor;
  }
  _button.configuration = configuration;
  // One line, so the title truncates in a box narrower than it.
  _button.titleLabel.numberOfLines = 1;
}

- (void)ngn_sendPress
{
  if (_eventEmitter) {
    std::static_pointer_cast<const NgNativeButtonEventEmitter>(_eventEmitter)->onButtonPress();
  }
}

@end
