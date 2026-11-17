// Which scene a window opens in on an iPad, by the key of the window each scene session had, apart
// from the module so the unit tests reach it without React Native. iPadOS keeps a session across
// launches, so the host keeps each one's key in the app's user defaults, by the session's
// persistent identifier, and a scene iPadOS restores goes back to the window it had. A session's
// own `userInfo` is not used: iPadOS can lose a change to it when the app is killed soon after.
#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Whether one of the app's windows had the session's scene: one iPadOS restores or connects again,
// not a New Window the user made. `kept` maps a session's identifier to its window's key, or to an
// empty string for a window with no key.
BOOL NgNativeSessionHadWindow(NSDictionary *_Nullable kept, NSString *session);

// The key of the window the session's scene had, or nil for none.
NSString *_Nullable NgNativeSessionKey(NSDictionary *_Nullable kept, NSString *session);

// `kept` with the session's scene marked as a window's, with `key`, or no key when it is nil.
NSDictionary *NgNativeKeepSession(NSDictionary *_Nullable kept, NSString *session, NSString *_Nullable key);

// `kept` without the sessions iPadOS no longer keeps: only those in `open`.
NSDictionary *NgNativeKeepOpenSessions(NSDictionary *_Nullable kept, NSSet<NSString *> *open);

// Which of the scenes waiting for a window, given the key each one's session had (NSNull for
// none), a window with `key` opens in: the one kept for its key, else the first kept for none. A
// scene kept for another key waits for that key. NSNotFound where none fits.
NSUInteger NgNativeSceneForKey(NSArray *sceneKeys, NSString *_Nullable key);

// Which of `sessions`, iPadOS's sessions with no scene connected, had the window with `key`: a
// window iPadOS lists as hidden, which the app opens there rather than in a new scene. NSNotFound
// for none, and always for a window with no key.
NSUInteger NgNativeSessionForKey(NSDictionary *_Nullable kept, NSArray<NSString *> *sessions, NSString *_Nullable key);

NS_ASSUME_NONNULL_END
