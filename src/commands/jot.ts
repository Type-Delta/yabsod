import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { evaluateAndUnlockAchievements, tierLabel } from '@/modules/achievements';
import { collectCrashEvents } from '@/modules/crash-sources';
import { upsertEvents } from '@/modules/events';
import { quickPrint, info, spinner } from '@/modules/shell';

const cmd: CommandModule = {
   async run(ctx) {
      const background = !!ctx.args.popOption('--background');
      const isTTY = !!process.stdout.isTTY;

      const spin = isTTY ? spinner({ message: 'Scanning Event Log + Reliability Monitor...' }) : null;
      const startedAt = Date.now();

      const events = await collectCrashEvents(background);
      spin?.setMessage('Writing crash events into sqlite...');
      const writeResult = await upsertEvents(events);

      spin?.setMessage('Evaluating achievements...');
      const achievementResult = await evaluateAndUnlockAchievements();
      spin?.stop();

      const tookMs = Date.now() - startedAt;

      quickPrint(`\n${ncc('Bright')}${ncc('Cyan')}Jot Summary${ncc()}`);
      quickPrint(`  scanned events: ${events.length}`);
      quickPrint(`  inserted: ${ncc('Green')}${writeResult.inserted}${ncc()}`);
      quickPrint(`  skipped duplicates: ${writeResult.skipped}`);
      quickPrint(`  new achievements: ${ncc('Yellow')}${achievementResult.newlyUnlocked.length}${ncc()}`);
      quickPrint(`  mode: ${background ? 'background (lower resource mode)' : 'fast (parallel mode)'}`);
      quickPrint(`  duration: ${(tookMs / 1000).toFixed(2)}s`);

      if (achievementResult.newlyUnlocked.length > 0) {
         quickPrint(`\n${ncc('Bright')}Unlocked${ncc()}`);
         for (const achievement of achievementResult.newlyUnlocked) {
            quickPrint(`  - ${achievement.name} ${tierLabel(achievement.tier)}`);
         }
      }

      if (writeResult.inserted === 0) {
         info('No new crash events found. Your machine might be behaving today.');
      }

      return 0;
   },
   help: {
      short: 'Ingest crash data into sqlite database.',
      usage: 'yabsod jot [--background]',
      long: 'Reads Event Log + Reliability Monitor, stores normalized crash records, then updates achievements.',
   },
};

export default cmd;
