import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { evaluateAndUnlockAchievements, tierLabel } from '@/modules/achievements';
import { collectCrashEvents } from '@/modules/crash-sources';
import { rehydrateEvents, upsertEvents } from '@/modules/events';
import { isAdministratorSession } from '@/modules/powershell';
import { header, kv, panel } from '@/modules/render';
import { quickPrint, info, spinner, warn } from '@/modules/shell';

const cmd: CommandModule = {
   async run(ctx) {
      const background = !!ctx.args.popOption('--background');
      const rehydrate = !!ctx.args.popOption('--rehydrate');
      const isTTY = !!process.stdout.isTTY;

      const hasAdmin = await isAdministratorSession();
      if (!hasAdmin) {
         warn(
            'Running without Administrator rights. Some dump/driver metadata may be unavailable. Rerun elevated for best results.'
         );
      }

      const spin = isTTY ? spinner({ message: 'Scanning Event Log + Reliability Monitor...' }) : null;
      const startedAt = Date.now();

      const events = await collectCrashEvents(background);
      spin?.setMessage(rehydrate ? 'Rehydrating crash metadata in sqlite...' : 'Writing crash events into sqlite...');

      let inserted = 0;
      let skipped = 0;
      let rehydratedScanned = 0;
      let rehydratedMatched = 0;
      let rehydratedUpdated = 0;

      if (rehydrate) {
         const result = await rehydrateEvents(events);
         rehydratedScanned = result.scanned;
         rehydratedMatched = result.matched;
         rehydratedUpdated = result.updated;
      } else {
         const result = await upsertEvents(events);
         inserted = result.inserted;
         skipped = result.skipped;
      }

      spin?.setMessage('Evaluating achievements...');
      const achievementResult = await evaluateAndUnlockAchievements();
      spin?.stop();

      const tookMs = Date.now() - startedAt;

      const rows: Array<[string, string]> = [['scanned events', String(events.length)]];
      if (rehydrate) {
         rows.push(['scanned db events', String(rehydratedScanned)]);
         rows.push(['matched events', String(rehydratedMatched)]);
         rows.push(['rehydrated', `${ncc('Green')}${rehydratedUpdated}${ncc()}`]);
      } else {
         rows.push(['inserted', `${ncc('Green')}${inserted}${ncc()}`]);
         rows.push(['skipped duplicates', String(skipped)]);
      }
      rows.push(['new achievements', `${ncc('Yellow')}${achievementResult.newlyUnlocked.length}${ncc()}`]);
      rows.push(['mode', background ? 'background (lower resource)' : 'fast (parallel)']);
      rows.push(['duration', `${(tookMs / 1000).toFixed(2)}s`]);

      quickPrint('');
      quickPrint(panel('Jot Summary', kv(rows), 46));

      if (achievementResult.newlyUnlocked.length > 0) {
         quickPrint('');
         quickPrint(header('Unlocked'));
         quickPrint('');
         for (const achievement of achievementResult.newlyUnlocked) {
            quickPrint(`  ${ncc('Yellow')}★${ncc()} ${achievement.name} ${tierLabel(achievement.tier)}`);
         }
      }

      if (!rehydrate && inserted === 0) {
         info('No new crash events found. Your machine might be behaving today.');
      }

      if (rehydrate && rehydratedUpdated === 0) {
         info('No stored events needed metadata refresh.');
      }

      return 0;
   },
   help: {
      short: 'Ingest crash data into sqlite database.',
      usage: 'yabsod jot [--background] [--rehydrate]',
      long: 'Reads Event Log + Reliability Monitor, stores normalized crash records, optionally rehydrates existing records, then updates achievements.',
   },
};

export default cmd;
