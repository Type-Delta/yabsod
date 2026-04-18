#!/usr/bin/env node
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '../dist');
const jsEntry = path.join(DIST_DIR, 'index.js');

if (!fs.existsSync(jsEntry)) {
   console.error('[yabsod] dist/index.js not found.');
   console.error('[yabsod] Please reinstall or run `npm run build` first.');
   process.exit(1);
}

import(require('url').pathToFileURL(jsEntry)).catch((err) => {
   console.error('Failed to start yabsod:', err);
   process.exit(1);
});
