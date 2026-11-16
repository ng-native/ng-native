/**
 * Claiming a host node, for the elements navigation owns.
 *
 * The engine reports any registered element name that reaches a commit without a component
 * behind it, which is how a template that forgot an import is caught. Navigation's elements need
 * the same treatment for the opposite reason: the outlet creates a `screen` itself, and the
 * header components own theirs, so both are accounted for rather than reported. `ownHost` also
 * takes off a prop a static attribute wrote that an input consumed: `<native-header
 * title="Settings">` feeds the input and writes a `title` attribute, and only the input's value
 * should survive.
 */
export { ownHost } from '@ng-native/device';
