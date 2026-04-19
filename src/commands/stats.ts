import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { markAllAchievementsViewed } from '@/modules/achievements';
import { summarizeStats } from '@/modules/events';
import { quoteForCrashCount } from '@/modules/quotes';
import {
   formatCount,
   header,
   horizontalBars,
   progressBar,
   renderCardGrid,
   renderHeatmap,
} from '@/modules/render';
import { formatHour } from '@/modules/date';
import { quickPrint, warn } from '@/modules/shell';
import { TimeRange } from '@/types';
import { COLOR_PALETTE } from '@/consts';

const cmd: CommandModule = {
   async run(ctx) {
      const range =
         parseRange(
            ctx.args.popValue('--range') ?? ctx.args.popValue('-r') ?? ctx.args.popValue('--since')
         ) || 'week';

      const summary = await summarizeStats(range);
      await markAllAchievementsViewed();

      const ratioTotal = summary.selectedRangeBsod + summary.selectedRangeApp;
      const bsodPct =
         ratioTotal > 0 ? Math.round((summary.selectedRangeBsod / ratioTotal) * 100) : 0;
      const appPct = ratioTotal > 0 ? 100 - bsodPct : 0;

      const topHoursRows = summary.topHours.map((row) => ({
         label: formatHour(row.hour),
         count: row.count,
      }));

      const cards = [
         `${header('Crash Totals')}
  today: ${ncc('Yellow')}${formatCount(summary.totalToday)}${ncc()}
  week: ${ncc('Yellow')}${formatCount(summary.totalWeek)}${ncc()}
  month: ${ncc('Yellow')}${formatCount(summary.totalMonth)}${ncc()}
  all-time: ${ncc('Yellow')}${formatCount(summary.totalAllTime)}${ncc()}`,

         `${header('BSOD vs App Ratio')}
  BSOD ${ncc(COLOR_PALETTE.blue600)}${summary.selectedRangeBsod}${ncc()} (${bsodPct}%)
  APP  ${ncc(COLOR_PALETTE.rose600)}${summary.selectedRangeApp}${ncc()} (${appPct}%)`,

         `${header('Uptime Flex')}
  current: ${summary.currentUptimeDays} days
  longest: ${summary.longestUptimeDays} days
  ${progressBar(summary.currentUptimeDays, Math.max(1, summary.longestUptimeDays))}`,

         `${header('Days Since Last BSOD')}
  ${summary.daysSinceLastBsod < 0 ? 'no BSOD found in DB' : `${summary.daysSinceLastBsod} day(s)`}`,

         `${header('System Stability Score')}
  ${ncc('Red')}2/10${ncc()} (as promised, permanently scuffed)`,

         `${header('Meme Quote')}
  ${quoteForCrashCount(summary.selectedRangeTotal)}`,
      ];

      quickPrint('');
      quickPrint(`${header('YABSOD Stats')} ${ncc('Dim')}[range: ${range}]${ncc()}`);
      quickPrint(renderCardGrid(cards, process.stdout.columns || 100));
      quickPrint(renderHeatmap(summary, 52));
      quickPrint('');
      quickPrint(horizontalBars('Top Problem Hours', topHoursRows, { color: 0x0ea5e9, width: 24 }));
      quickPrint('');
      quickPrint(horizontalBars('Top Crashed Apps', summary.topApps, { color: COLOR_PALETTE.rose600, width: 24 }));
      quickPrint('');
      quickPrint(horizontalBars('Top BugChecks', summary.topBugChecks, { color: COLOR_PALETTE.blue600, width: 24 }));
      quickPrint('');
      quickPrint(horizontalBars('Top BSOD Processes', summary.topProcesses, { color: 0x7c3aed, width: 24 }));

      if (summary.selectedRangeTotal === 0) {
         warn('No crashes found for this range yet. Run `yabsod jot` first to import events.');
      }

      return 0;
   },
   help: {
      short: 'Display crash stats with heatmap and charts.',
      usage: 'yabsod stats [--range week|month|all-time]',
      long: 'Shows crash totals, BSOD/app ratio, heatmap, uptime comparison, top hours, and top offenders.',
   },
};

function parseRange(value: string | null): TimeRange | null {
   if (!value) return null;
   const v = value.toLowerCase();
   if (v === 'week' || v === 'w') return 'week';
   if (v === 'month' || v === 'm') return 'month';
   if (v === 'all-time' || v === 'all' || v === 'a') return 'all-time';
   return null;
}

export default cmd;
