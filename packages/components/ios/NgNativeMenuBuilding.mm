#import "NgNativeMenuBuilding.h"

static NSString *stringOf(id value)
{
  return [value isKindOfClass:[NSString class]] ? value : nil;
}

static BOOL flagOf(id value)
{
  return [value isKindOfClass:[NSNumber class]] && [value boolValue];
}

NSString *_Nullable NgNativeKeyInput(NSDictionary *shortcut, UIKeyModifierFlags *flags)
{
  NSString *key = stringOf(shortcut[@"key"]);
  if (key.length == 0) {
    return nil;
  }
  UIKeyModifierFlags modifiers = 0;
  if (flagOf(shortcut[@"meta"])) modifiers |= UIKeyModifierCommand;
  if (flagOf(shortcut[@"ctrl"])) modifiers |= UIKeyModifierControl;
  if (flagOf(shortcut[@"alt"])) modifiers |= UIKeyModifierAlternate;
  if (flagOf(shortcut[@"shift"])) modifiers |= UIKeyModifierShift;
  *flags = modifiers;
  if (key.length == 1) {
    return key.lowercaseString;
  }
  // KeyboardEvent.key names, as parseShortcut keeps them.
  static NSDictionary<NSString *, NSString *> *named;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableDictionary *keys = [@{
      @"ArrowUp" : UIKeyInputUpArrow,
      @"ArrowDown" : UIKeyInputDownArrow,
      @"ArrowLeft" : UIKeyInputLeftArrow,
      @"ArrowRight" : UIKeyInputRightArrow,
      @"Escape" : UIKeyInputEscape,
      @"Enter" : @"\r",
      @"Tab" : @"\t",
      @"Backspace" : @"\b",
      @"Space" : @" ",
      @"PageUp" : UIKeyInputPageUp,
      @"PageDown" : UIKeyInputPageDown,
      @"Home" : UIKeyInputHome,
      @"End" : UIKeyInputEnd,
      @"Delete" : UIKeyInputDelete,
    } mutableCopy];
    NSArray<NSString *> *functionKeys = @[
      UIKeyInputF1, UIKeyInputF2, UIKeyInputF3, UIKeyInputF4, UIKeyInputF5, UIKeyInputF6,
      UIKeyInputF7, UIKeyInputF8, UIKeyInputF9, UIKeyInputF10, UIKeyInputF11, UIKeyInputF12,
    ];
    [functionKeys enumerateObjectsUsingBlock:^(NSString *input, NSUInteger index, BOOL *stop) {
      keys[[NSString stringWithFormat:@"F%lu", (unsigned long)index + 1]] = input;
    }];
    named = keys;
  });
  return named[key];
}

static UIMenuElementAttributes attributesOf(NSDictionary *entry)
{
  UIMenuElementAttributes attributes = 0;
  if (flagOf(entry[@"disabled"])) attributes |= UIMenuElementAttributesDisabled;
  if (flagOf(entry[@"destructive"])) attributes |= UIMenuElementAttributesDestructive;
  return attributes;
}

static UIImage *_Nullable imageOf(NSDictionary *entry)
{
  NSString *symbol = stringOf(entry[@"sfSymbol"]);
  return symbol.length > 0 ? [UIImage systemImageNamed:symbol] : nil;
}

static UIMenuElement *_Nullable elementOf(NSDictionary *entry, NgNativeMenuChoose choose, SEL keyCommandAction)
{
  NSString *itemId = stringOf(entry[@"id"]) ?: @"";
  NSString *label = stringOf(entry[@"label"]) ?: @"";
  NSArray *items = [entry[@"items"] isKindOfClass:[NSArray class]] ? entry[@"items"] : nil;
  if (items != nil) {
    UIMenuOptions options = flagOf(entry[@"inline"]) ? UIMenuOptionsDisplayInline : 0;
    return [UIMenu menuWithTitle:label
                           image:imageOf(entry)
                      identifier:nil
                         options:options
                        children:NgNativeMenuElements(items, choose, keyCommandAction)];
  }
  NSString *role = stringOf(entry[@"menuRole"]);
  if (role != nil && !flagOf(entry[@"handled"])) {
    // Back and Forward have no UIKit command: the menu bar sends them as `navigate`.
    if (keyCommandAction != NULL && ([role isEqualToString:@"back"] || [role isEqualToString:@"forward"])) {
      itemId = [@"navigate:" stringByAppendingString:role];
    } else {
      // A role the OS fills itself, such as Copy: UIKit's own menus have it.
      return nil;
    }
  }
  NSDictionary *shortcut = [entry[@"shortcut"] isKindOfClass:[NSDictionary class]] ? entry[@"shortcut"] : nil;
  UIKeyModifierFlags flags = 0;
  NSString *input = shortcut != nil ? NgNativeKeyInput(shortcut, &flags) : nil;
  UIMenuElement *element;
  if (keyCommandAction != NULL) {
    UICommand *command = input != nil
        ? [UIKeyCommand commandWithTitle:label
                                   image:imageOf(entry)
                                  action:keyCommandAction
                                   input:input
                           modifierFlags:flags
                            propertyList:itemId]
        : [UICommand commandWithTitle:label image:imageOf(entry) action:keyCommandAction propertyList:itemId];
    command.attributes = attributesOf(entry);
    command.state = flagOf(entry[@"checked"]) ? UIMenuElementStateOn : UIMenuElementStateOff;
    command.discoverabilityTitle = label;
    element = command;
  } else {
    UIAction *action = [UIAction actionWithTitle:label
                                           image:imageOf(entry)
                                      identifier:nil
                                         handler:^(__kindof UIAction *chosen) {
                                           choose(itemId);
                                         }];
    action.attributes = attributesOf(entry);
    action.state = flagOf(entry[@"checked"]) ? UIMenuElementStateOn : UIMenuElementStateOff;
    element = action;
  }
  NSString *subtitle = stringOf(entry[@"subtitle"]);
  if (subtitle.length > 0) {
    element.subtitle = subtitle;
  }
  return element;
}

NSArray<UIMenuElement *> *NgNativeMenuElements(NSArray *entries, NgNativeMenuChoose choose, SEL keyCommandAction)
{
  NSMutableArray<NSArray<UIMenuElement *> *> *groups = [NSMutableArray arrayWithObject:@[]];
  for (id entry in entries) {
    if (![entry isKindOfClass:[NSDictionary class]]) {
      continue;
    }
    if (flagOf(entry[@"separator"])) {
      if (groups.lastObject.count > 0) {
        [groups addObject:@[]];
      }
      continue;
    }
    UIMenuElement *element = elementOf(entry, choose, keyCommandAction);
    if (element != nil) {
      groups[groups.count - 1] = [groups.lastObject arrayByAddingObject:element];
    }
  }
  if (groups.lastObject.count == 0) {
    [groups removeLastObject];
  }
  if (groups.count <= 1) {
    return groups.firstObject ?: @[];
  }
  NSMutableArray<UIMenuElement *> *elements = [NSMutableArray array];
  for (NSArray<UIMenuElement *> *group in groups) {
    [elements addObject:[UIMenu menuWithTitle:@"" image:nil identifier:nil options:UIMenuOptionsDisplayInline children:group]];
  }
  return elements;
}
