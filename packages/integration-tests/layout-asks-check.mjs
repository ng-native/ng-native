// The layout tests once more, with every engine checking that no box is laid out by something
// no declaration asked for: a sheet or a style the engine does not read for what it asks, which
// would leave an app that uses only that laid out by Yoga alone. See `Engine.asked`.
globalThis.ɵngNativeLayoutAsks = 'check';
