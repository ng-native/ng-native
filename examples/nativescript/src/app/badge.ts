import { androidContext, nsView } from '@ng-native/nativescript';

/** An Android `TextView`, filled when highlighted. Android only. */
export const badge = nsView<{ text: string; highlighted: boolean }, android.widget.TextView>({
  create(props) {
    'worklet';
    const view = new android.widget.TextView(androidContext() as android.content.Context);
    view.setGravity(android.view.Gravity.CENTER);
    view.setTextSize(20);
    view.setText(props.text);
    view.setBackgroundColor(
      android.graphics.Color.parseColor(props.highlighted ? '#5856d6' : '#e5e5ea'),
    );
    view.setTextColor(android.graphics.Color.parseColor(props.highlighted ? '#ffffff' : '#000000'));
    return view;
  },
  update(view, props) {
    'worklet';
    view.setText(props.text);
    view.setBackgroundColor(
      android.graphics.Color.parseColor(props.highlighted ? '#5856d6' : '#e5e5ea'),
    );
    view.setTextColor(android.graphics.Color.parseColor(props.highlighted ? '#ffffff' : '#000000'));
  },
});
