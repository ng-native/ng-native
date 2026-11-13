/** The stylesheet the Metro config generates from the Tailwind entry. */
declare module '*.tailwind.js' {
  const sheet: import('@ng-native/fabric').StyleSheet;
  export default sheet;
}
