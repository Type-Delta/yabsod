import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { parseLimit, parseTimeFilter } from '@/modules/args';
import { formatDateTime } from '@/modules/date';
import { listEvents } from '@/modules/events';
import { header } from '@/modules/render';
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

      quickPrint('');
      quickPrint(header(`Crash Events · ${events.length} shown`));
      quickPrint('');

      const rows = events.map((event) =>
         event.crashType === 'bsod'
            ? {
               id: event.shortId,
               time: formatDateTime(event.timestamp),
               type: 'BSOD',
               color: COLOR_PALETTE.blue600,
               detail: [event.bugCheckName || event.bugCheckCode || 'UnknownBugCheck', event.processName]
                  .filter(Boolean)
                  .join(` ${ncc('Dim')}·${ncc()} `),
            }
            : {
               id: event.shortId,
               time: formatDateTime(event.timestamp),
               type: 'APP',
               color: COLOR_PALETTE.rose600,
               detail: event.applicationName || 'UnknownApp',
            }
      );

      const idPad = Math.max(...rows.map((row) => row.id.length), 2);
      const timePad = Math.max(...rows.map((row) => row.time.length), 4);

      quickPrint(
         `  ${ncc('Dim')}${'ID'.padEnd(idPad)}  ${'TIME'.padEnd(timePad)}  TYPE  DETAIL${ncc()}`
      );

      for (const row of rows) {
         quickPrint(
            `  ${ncc(row.color)}${row.id.padEnd(idPad)}${ncc()}  ${ncc('Dim')}${row.time.padEnd(timePad)}${ncc()}  ${ncc(row.color)}${row.type.padEnd(4)}${ncc()}  ${row.detail}`
         );
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
