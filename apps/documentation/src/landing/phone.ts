/**
 * A phone as it looks in the hand, with a real screen in it: the hero's frame.
 *
 * The rest of the page draws its devices in ink (`device.ts`); the hero is the one place that
 * shows the product the way a store listing would, so its phones are rendered - a metal edge, a
 * black bezel, side buttons, and the shadow of something sitting a few centimetres off the page.
 * The screen is still a capture from the simulator or emulator, never a mock (see `README.md`).
 */
import { Component, computed, input } from '@angular/core';

export type DevicePlatform = 'ios' | 'android';

/** The captures' own proportions: 1206 x 2622 on iOS, 1080 x 2400 on Android. */
const SCREEN_RATIO: Record<DevicePlatform, string> = { ios: '1206 / 2622', android: '1080 / 2400' };

@Component({
  selector: 'landing-phone',
  template: `
    <div class="phone" [attr.data-platform]="platform()">
      <span class="phone-button is-action" aria-hidden="true"></span>
      <span class="phone-button is-volume-up" aria-hidden="true"></span>
      <span class="phone-button is-volume-down" aria-hidden="true"></span>
      <span class="phone-button is-power" aria-hidden="true"></span>
      <div class="phone-screen" [style.aspect-ratio]="ratio()">
        <img
          [src]="source()"
          [alt]="alt()"
          width="560"
          [attr.height]="platform() === 'ios' ? 1217 : 1244"
          [attr.loading]="eager() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="eager() ? 'high' : null"
          decoding="async"
        />
        @if (platform() === 'android') {
          <span class="phone-camera" aria-hidden="true"></span>
        }
      </div>
    </div>
  `,
  host: { class: 'block' },
  styles: `
    .phone {
      position: relative;
      padding: 3.6%;
      border-radius: 15% / 7%;
      background: #0b0b0d;
      /* The metal edge: a lit rim over a dark band, then the drop shadows that lift it off the page. */
      box-shadow:
        0 0 0 1.5px #9a9aa2,
        0 0 0 3.5px #2c2c31,
        0 0 0 4.5px #5c5c63,
        inset 0 0 0 1px rgb(255 255 255 / 0.06),
        0 2px 3px rgb(0 0 0 / 0.25),
        0 24px 48px -16px rgb(16 12 40 / 0.35),
        0 60px 90px -44px rgb(16 12 40 / 0.35);
    }
    .phone[data-platform='android'] {
      padding: 3%;
      border-radius: 11% / 5.2%;
      box-shadow:
        0 0 0 2px #1a1a1d,
        0 0 0 3.5px #45454b,
        inset 0 0 0 1px rgb(255 255 255 / 0.05),
        0 2px 3px rgb(0 0 0 / 0.25),
        0 24px 48px -16px rgb(16 12 40 / 0.35),
        0 60px 90px -44px rgb(16 12 40 / 0.35);
    }
    .phone-screen {
      position: relative;
      overflow: hidden;
      border-radius: 12.5% / 5.8%;
      background: #000;
    }
    .phone[data-platform='android'] .phone-screen {
      border-radius: 9% / 4.1%;
    }
    .phone-screen img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .phone-camera {
      position: absolute;
      top: 1.6%;
      left: 50%;
      width: 3.2%;
      aspect-ratio: 1;
      transform: translateX(-50%);
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #2a2a36, #050507 70%);
      box-shadow: 0 0 0 1.5px #111;
    }
    .phone-button {
      position: absolute;
      width: 1.2%;
      border-radius: 2px;
      background: linear-gradient(90deg, #4a4a50, #8e8e96, #4a4a50);
    }
    .phone-button.is-action {
      left: -1.8%;
      top: 15%;
      height: 4%;
    }
    .phone-button.is-volume-up {
      left: -1.8%;
      top: 22%;
      height: 7%;
    }
    .phone-button.is-volume-down {
      left: -1.8%;
      top: 31%;
      height: 7%;
    }
    .phone-button.is-power {
      right: -1.8%;
      top: 24%;
      height: 11%;
    }
    .phone[data-platform='android'] .phone-button.is-action,
    .phone[data-platform='android'] .phone-button.is-volume-down {
      display: none;
    }
    .phone[data-platform='android'] .phone-button.is-volume-up {
      left: auto;
      right: -1.6%;
      top: 30%;
      height: 10%;
    }
    .phone[data-platform='android'] .phone-button.is-power {
      top: 18%;
      height: 6%;
    }
  `,
})
export class LandingPhone {
  readonly platform = input.required<DevicePlatform>();
  /** A capture's base name: `player` for `player-ios-light.webp`. */
  readonly shot = input('');
  /** A capture anywhere under `public/`, in place of `shot`: the example apps keep their own. */
  readonly src = input<string>();
  /** Which of the capture's themes: `settings` has both, `plans` is photographed dark. */
  readonly scheme = input<'light' | 'dark'>('light');
  readonly alt = input('');
  readonly eager = input(false);

  protected readonly ratio = computed(() => SCREEN_RATIO[this.platform()]);
  protected readonly source = computed(() => this.src() ?? this.path(this.shot()));

  private path(shot: string): string {
    return `/showcase/${shot}-${this.platform()}-${this.scheme()}.webp`;
  }
}
