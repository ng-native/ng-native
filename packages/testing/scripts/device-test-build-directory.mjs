import path from 'node:path';
import { ANDROID_HOST_ABI, nativeBuildDirectory } from '../src/device/native-build.ts';

const [project, os] = process.argv.slice(2);
if (!project || (os !== 'ios' && os !== 'android')) {
  throw new Error('Usage: device-test-build-directory.mjs <project> <ios|android>');
}

const directory = await nativeBuildDirectory(
  path.resolve(project),
  os,
  os === 'android' ? ANDROID_HOST_ABI : undefined,
);
console.log(path.relative(process.cwd(), directory));
