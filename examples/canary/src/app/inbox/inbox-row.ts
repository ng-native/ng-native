import { Component, computed, effect, input, output, untracked } from '@angular/core';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { cancelAnimation, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Pressable, Text, View } from '@ng-native/components';
import { NativeGesture } from '@ng-native/components/gestures';
import {
  WorkletStyle,
  releaseOnDestroy,
  sharedValue,
  workletStyle,
} from '@ng-native/components/reanimated';
import type { Mail } from './inbox-model.ts';

/** How far a swipe opens the row to show its actions. */
const REVEAL = 160;
/** Past this, letting go deletes. */
const FULL = 260;
/** Off the edge of any phone. */
const GONE = 480;

/**
 * One message: swipe left to show Archive and Delete, or all the way to delete; tap to open, or
 * to close it again when open; press and hold to start selecting. The swipe runs on the UI thread
 * and only its outcome reaches Angular.
 *
 * The row is recycled as the list scrolls, and its swipe position is a field of the component, so
 * a new message closes it: otherwise the next message into this slot would arrive half open.
 */
@Component({
  selector: 'x-inbox-row',
  imports: [NativeGesture, Pressable, Text, View, WorkletStyle],
  template: `
    <view class="row">
      <view class="actions">
        <pressable
          class="action archive"
          accessibilityRole="button"
          [accessibilityLabel]="'Archive ' + mail().subject"
          (press)="archived.emit()"
        >
          <text class="action-label">Archive</text>
        </pressable>
        <pressable
          class="action delete"
          accessibilityRole="button"
          [accessibilityLabel]="'Delete ' + mail().subject"
          (press)="removed.emit()"
        >
          <text class="action-label">Delete</text>
        </pressable>
      </view>
      <view
        class="front"
        [class.chosen]="selected()"
        [nativeID]="'front-' + mail().id"
        [gesture]="gesture()"
        [workletStyle]="slide"
        accessibilityRole="button"
        [accessibilityLabel]="mail().from + ', ' + mail().subject"
        [accessibilityActions]="actions"
        (accessibilityAction)="act($event.nativeEvent.actionName)"
      >
        <view class="line">
          <text class="from" [class.unread]="mail().unread">{{ mail().from }}</text>
          @if (selected()) {
            <text class="tick">Selected</text>
          }
        </view>
        <text class="subject" [numberOfLines]="1">{{ mail().subject }}</text>
        <text class="hint" [numberOfLines]="1">{{ mail().preview }}</text>
      </view>
    </view>
  `,
  styles: `
    .row {
      height: 84px;
    }
    .actions {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 160px;
      flex-direction: row;
    }
    .action {
      flex: 1;
      align-items: center;
      justify-content: center;
    }
    .archive {
      background-color: rgb(59, 110, 245);
    }
    .delete {
      background-color: rgb(220, 53, 53);
    }
    .action-label {
      color: rgb(255, 255, 255);
      font-weight: 600;
    }
    .front {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 10px 16px;
      background-color: var(--card);
      border-bottom-width: 1px;
      border-bottom-color: var(--line);
    }
    .chosen {
      background-color: var(--card-inset);
    }
    .line {
      flex-direction: row;
      justify-content: space-between;
    }
    .from {
      color: var(--text-strong);
      font-size: 15px;
    }
    .unread {
      font-weight: 700;
    }
    .tick {
      color: var(--accent);
      font-size: 13px;
    }
    .subject {
      color: var(--text);
      font-size: 15px;
    }
  `,
})
export class InboxRow {
  readonly mail = input.required<Mail>();
  readonly selected = input(false);
  /**
   * The native gesture of a scroll view that also moves sideways, a pager, which then waits for
   * this row's swipe to fail before it takes a horizontal drag.
   */
  readonly outer = input<GestureType>();
  readonly opened = output<void>();
  readonly held = output<void>();
  readonly archived = output<void>();
  readonly removed = output<void>();

  private readonly x = sharedValue(0);
  protected readonly slide = workletStyle([this.x], (x) => {
    'worklet';
    return { transform: [{ translateX: x.value }] };
  });
  protected readonly actions = [
    { name: 'archive', label: 'Archive' },
    { name: 'delete', label: 'Delete' },
  ];
  protected readonly gesture;

  constructor() {
    // Read through locals: a gesture callback is rewritten into a worklet, which has no `this`,
    // and so is a function handed to one directly, as `hold` is.
    const [x, removed, opened, held] = [this.x, this.removed, this.opened, this.held];
    // Handed to `scheduleOnRN` from the pan's worklet, which native code keeps for good: through
    // `releaseOnDestroy`, so a row that has gone is not kept with it.
    const remove = releaseOnDestroy(() => removed.emit());
    const open = () => opened.emit();
    const hold = () => held.emit();

    const pan = Gesture.Pan()
      // Left only: a drag to the right fails this swipe at once, so the pager it blocks, which
      // waits for it to fail, can take the drag instead.
      .activeOffsetX(-12)
      .failOffsetX(12)
      .failOffsetY([-10, 10])
      .onChange((event) => {
        'worklet';
        x.value = Math.max(-GONE, Math.min(0, x.value + event.changeX));
      })
      .onEnd((event) => {
        'worklet';
        if (x.value < -FULL || event.velocityX < -1500) {
          x.value = withTiming(-GONE, { duration: 160 }, (finished) => {
            'worklet';
            if (finished) scheduleOnRN(remove);
          });
        } else {
          x.value = withSpring(x.value < -REVEAL / 2 ? -REVEAL : 0);
        }
      });
    // A tap on an open row closes it rather than opening the message, as Mail does.
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => {
        if (x.value !== 0) x.value = withSpring(0);
        else open();
      });
    const press = Gesture.LongPress().minDuration(400).runOnJS(true).onStart(hold);
    this.gesture = computed(() => {
      const outer = this.outer();
      return Gesture.Race(
        outer ? pan.blocksExternalGesture(outer) : pan,
        Gesture.Exclusive(press, tap),
      );
    });

    effect(() => {
      this.mail().id;
      untracked(() => {
        cancelAnimation(x);
        x.value = 0;
      });
    });
  }

  protected act(name: string): void {
    if (name === 'delete') this.removed.emit();
    if (name === 'archive') this.archived.emit();
  }
}
