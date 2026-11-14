/**
 * Stack positions in the app as positions in source files, by Metro's own symbolication: the app
 * runs bundles, so its stacks point into them.
 */

export interface Frame {
  methodName: string;
  file?: string;
  lineNumber?: number;
  column?: number;
}

type Parse = (stack: string) => Frame[];
type Symbolicate = (frames: Frame[]) => Promise<{ stack: Frame[] }>;

function devtools(): { parse: Parse; symbolicate: Symbolicate } {
  const parse = (
    require('react-native/Libraries/Core/Devtools/parseErrorStack') as { default: Parse }
  ).default;
  const symbolicate = (
    require('react-native/Libraries/Core/Devtools/symbolicateStackTrace') as {
      default: Symbolicate;
    }
  ).default;
  return { parse, symbolicate };
}

/** Frames as source positions; a frame Metro cannot place stays as it was. */
export async function symbolicateFrames(frames: Frame[]): Promise<Frame[]> {
  try {
    return (await devtools().symbolicate(frames)).stack;
  } catch {
    return frames;
  }
}

/**
 * An error's stack as source positions, without the frames inside bundles or Hermes' own code
 * that Metro could not place, which only point at the runtime.
 */
export async function symbolicateStack(stack: string): Promise<string> {
  try {
    const frames = await symbolicateFrames(devtools().parse(stack));
    const message = stack.split('\n').filter((line) => !/^\s+at /.test(line));
    const lines = frames
      .filter(
        (frame) =>
          frame.file && !/InternalBytecode|\.bundle|ng-native-device-testing/.test(frame.file),
      )
      .map(
        (frame) => `    at ${frame.methodName} (${frame.file}:${frame.lineNumber}:${frame.column})`,
      );
    return [...message, ...lines].join('\n');
  } catch {
    return stack;
  }
}
