import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { parseLimit, parseTimeFilter } from '@/modules/args';
import { formatDateTime } from '@/modules/date';
import { listEvents } from '@/modules/events';
import { quickPrint, warn } from '@/modules/shell';
import { COLOR_PALETTE } from '@/consts';

const cmd: CommandModule = {
   async run(ctx) {
      const time = parseTimeFilter(ctx.args);
      const limit = parseLimit(ctx.args, 50);

      const crashType =
         (ctx.args.popOption('--bsod') && 'bsod') ||
         (ctx.args.popOption('--app') && 'app') ||
         (ctx.args.popValue('--type') as 'bsod' | 'app' | null);

      const appName = ctx.args.popValue('--app-name') ?? undefined;
      const bugCheck = ctx.args.popValue('--bugcheck') ?? undefined;

      const events = await listEvents({
         since: time.since,
         until: time.until,
         crashType: crashType ?? undefined,
         appName,
         bugCheck,
         limit,
      });

      if (events.length === 0) {
         warn('No crash events matched your filter.');
         return 0;
      }

      quickPrint(
         `\n${ncc('Bright')}${ncc('Cyan')}Crash Event List${ncc()} ${ncc('Dim')}(${events.length})${ncc()}`
      );

      for (const event of events) {
         if (event.crashType === 'bsod') {
            quickPrint(
               `  ${ncc(COLOR_PALETTE.blue600)}${event.shortId}${ncc()}  ${formatDateTime(event.timestamp)}  BSOD  ${event.bugCheckName || event.bugCheckCode || 'UnknownBugCheck'}  ${event.processName || ''}`
            );
         } else {
            quickPrint(
               `  ${ncc(COLOR_PALETTE.red600)}${event.shortId}${ncc()}  ${formatDateTime(event.timestamp)}  APP   ${event.applicationName || 'UnknownApp'}`
            );
         }
      }

      return 0;
   },
   help: {
      short: 'List crash events with filtering.',
      usage: 'yabsod list [--since <date|7d>] [--until <date>] [--bsod|--app] [--app-name <name>] [--bugcheck <name>] [-n <limit>]',
      long: 'Shows indexed crash events. Use the hash prefix with `yabsod view <id>` for details.',
   },
};

export default cmd;
