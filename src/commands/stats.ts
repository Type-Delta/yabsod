import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { markAllAchievementsViewed } from '@/modules/achievements';
import { summarizeStats } from '@/modules/events';
import { quoteForCrashCount } from '@/modules/quotes';
import {
   formatCount,
   header,
   horizontalBars,
   kv,
   panel,
   panelGrid,
   progressBar,
   renderHeatmap,
   visibleWidth,
} from '@/modules/render';
import { formatHour } from '@/modules/date';
import { contentWidth, quickPrint, warn } from '@/modules/shell';
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

      const cardWidth = 40;
      const cards = [
         panel(
            'Crash Totals',
            kv([
               ['today', `${ncc('Yellow')}${formatCount(summary.totalToday)}${ncc()}`],
               ['week', `${ncc('Yellow')}${formatCount(summary.totalWeek)}${ncc()}`],
               ['month', `${ncc('Yellow')}${formatCount(summary.totalMonth)}${ncc()}`],
               ['all-time', `${ncc('Yellow')}${formatCount(summary.totalAllTime)}${ncc()}`],
            ]),
            cardWidth
         ),

         panel(
            'BSOD vs App Ratio',
            kv([
               ['BSOD', `${ncc(COLOR_PALETTE.blue600)}${summary.selectedRangeBsod}${ncc()} (${bsodPct}%)`],
               ['APP', `${ncc(COLOR_PALETTE.rose600)}${summary.selectedRangeApp}${ncc()} (${appPct}%)`],
            ]),
            cardWidth
         ),

         panel(
            'Uptime Flex',
            kv([
               ['current', `${summary.currentUptimeDays} days`],
               ['longest', `${summary.longestUptimeDays} days`],
            ]) +
            `\n${progressBar(summary.currentUptimeDays, Math.max(1, summary.longestUptimeDays), { width: cardWidth - 6 })}`,
            cardWidth
         ),

         panel(
            'Days Since Last BSOD',
            summary.daysSinceLastBsod < 0
               ? `${ncc('Dim')}no BSOD found in DB${ncc()}`
               : `${summary.daysSinceLastBsod} day(s)`,
            cardWidth
         ),

         panel(
            'System Stability Score',
            `${ncc('Red')}2/10${ncc()} ${ncc('Dim')}(as promised, permanently scuffed)${ncc()}`,
            cardWidth
         ),

         panel('Meme Quote', quoteForCrashCount(summary.selectedRangeTotal), cardWidth),
      ];

      quickPrint('');
      quickPrint(header(`YABSOD Stats · range: ${range}`));
      quickPrint('');
      quickPrint(panelGrid(cards, contentWidth, cardWidth));
      quickPrint('');
      quickPrint(renderHeatmap(summary, 52, contentWidth));
      quickPrint('');

      const chartLeft = [
         horizontalBars('Top Problem Hours', topHoursRows, { color: 0x0ea5e9, width: 24 }),
         horizontalBars('Top Crashed Apps', summary.topApps, { color: COLOR_PALETTE.rose600, width: 24 }),
      ].join('\n\n');
      const chartRight = [
         horizontalBars('Top BugChecks', summary.topBugChecks, { color: COLOR_PALETTE.blue600, width: 24 }),
         horizontalBars('Top BSOD Processes', summary.topProcesses, { color: 0x7c3aed, width: 24 }),
      ].join('\n\n');

      const chartWidth = Math.max(visibleWidth(chartLeft), visibleWidth(chartRight));
      if (contentWidth >= chartWidth * 2 + 2) {
         quickPrint(panelGrid([chartLeft, chartRight], contentWidth, chartWidth));
      } else {
         quickPrint(chartLeft);
         quickPrint('');
         quickPrint(chartRight);
      }

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
