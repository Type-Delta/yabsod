/* eslint-disable no-undef */
 

function isTruthy(value) {
   return value === '1' || value === 'true' || value === 'yes';
}

const ignoreScripts =
   isTruthy(process.env.npm_config_ignore_scripts) ||
   isTruthy(process.env.NPM_CONFIG_IGNORE_SCRIPTS);

if (ignoreScripts) {
   process.exit(0);
}

if (isTruthy(process.env.YABSOD_SKIP_POSTINSTALL)) {
   process.exit(0);
}
