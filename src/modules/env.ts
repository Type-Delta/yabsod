import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const IS_WINDOWS = process.platform === 'win32';

export function getDataDir(): string {
   const base = process.env.LOCALAPPDATA || os.homedir();
   const dir = path.join(base, 'yabsod');
   ensureDir(dir);
   return dir;
}

export function getCacheDir(): string {
   const dir = path.join(getDataDir(), 'cache');
   ensureDir(dir);
   return dir;
}

export function getDatabasePath(): string {
   return path.join(getDataDir(), 'yabsod.sqlite');
}

export function ensureDir(dirPath: string): void {
   if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
   }
}
