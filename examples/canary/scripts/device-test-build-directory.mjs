import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_HOST_ABI,
  nativeBuildDirectory,
} from '../../../packages/testing/src/device/native-build.ts';

const os = process.argv[2];
if (os !== 'ios' && os !== 'android') throw new Error('Expected ios or android');

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await nativeBuildDirectory(
  root,
  os,
  os === 'android' ? ANDROID_HOST_ABI : undefined,
);
console.log(path.relative(process.cwd(), directory));
