/**
 * The system share sheet.
 *
 * `Share.share` resolves either way - dismissing the sheet is not an error - and the distinction
 * it draws is one a caller usually wants: `shared` means an app took the content, `dismissed`
 * means they changed their mind, and only the first is worth a confirmation or an analytics event.
 */

import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

export interface ShareRequest {
  /** What is being shared. At least one of these; iOS prefers `url` when both are present. */
  readonly message?: string;
  readonly url?: string;
  /** Android's dialog title, and iOS's mail subject. */
  readonly title?: string;
}

export interface NativeSharing {
  share(request: ShareRequest): Promise<{ action: string; activityType?: string | null }>;
}

export function sharingSource(): NativeSharing | null {
  const native = reactNative();
  if (!native) return null;
  const android = native.Platform.OS === 'android';
  return { share: (request) => native.Share.share(android ? forAndroid(request) : request) };
}

/**
 * `Share.share` on Android reads `title` and `message` and nothing else - `url` is not a field
 * React Native's own Android module looks at, so a request built the iOS way, `{ url, title }`
 * with no `message`, opens a sheet with a title and an empty body and nothing to actually share.
 * React Native's own docs say as much: Android's `message` "will often include a URL". Folding it
 * in here is what makes `share({ url, title })` behave the same on both platforms, as the type
 * says it should.
 */
function forAndroid(request: ShareRequest): ShareRequest {
  if (!request.url) return request;
  const message = request.message ? `${request.message}\n${request.url}` : request.url;
  return { title: request.title, message };
}

@Service()
export class Sharing {
  /** Overridden in a test to answer the sheet without one opening. */
  static readonly SOURCE = new InjectionToken<NativeSharing | null>(
    'angular-native.sharingSource',
    { factory: sharingSource },
  );

  private readonly native = inject(Sharing.SOURCE);

  /** Whether React Native's module is here. Where it is not, every call is inert. */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  /**
   * Open the share sheet. Resolves to whether anything took the content.
   *
   * Failures resolve to false rather than rejecting: the sheet failing to open and the user
   * closing it are the same outcome at the call site, and neither is exceptional.
   */
  async share(request: ShareRequest): Promise<boolean> {
    if (!this.native) return false;
    if (!request.message && !request.url) return false;

    try {
      const { action } = await this.native.share(request);
      return action === 'sharedAction';
    } catch {
      return false;
    }
  }
}
