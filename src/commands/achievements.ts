import { ncc, strJustify, strWrap } from '@lib/Tools';

import { CommandModule } from '@/common';
import { achievementLabel, listAchievementStates, markAllAchievementsViewed } from '@/modules/achievements';
import { header, panel, panelGrid, progressBar } from '@/modules/render';
import { contentWidth, quickPrint } from '@/modules/shell';

const cmd: CommandModule = {
   async run(ctx) {
      const listMode = !!(ctx.args.popOption('-l') || ctx.args.popOption('--list'));

      const status =
         (ctx.args.popOption('--updated') && 'updated') ||
         (ctx.args.popOption('--unlocked') && 'unlocked') ||
         (ctx.args.popOption('--locked') && 'locked') ||
         undefined;

      const filter = ctx.args.popValue('-f') ?? ctx.args.popValue('--filter') ?? undefined;
      const achievements = await listAchievementStates({ filter, status });

      const updated = achievements.filter((item) => item.status === 'updated');
      const unlocked = achievements.filter((item) => item.status === 'unlocked');
      const locked = achievements.filter((item) => item.status === 'locked');

      if (listMode) {
         const listDisplayWidth = Math.min(80, contentWidth - 6);

         for (const section of [
            { label: 'Recently Updated', entries: updated },
            { label: 'Unlocked', entries: unlocked },
            { label: 'Locked', entries: locked },
         ]) {
            if (section.entries.length === 0) continue;
            quickPrint(`\n${header(`${section.label} · ${section.entries.length}`)}\n`);

            for (const item of section.entries) {
               const goal = item.nextGoal ? item.nextGoal : item.currentGoal;
               const bar = progressBar(item.progress, goal, {
                  width: listDisplayWidth,
                  progressNumber: 'fraction',
                  color: item.progress >= goal ? 'Green' : 'White',
               })
               quickPrint(`  ${achievementLabel(item)}`);
               const descriptions = item.afterCompletion ? [item.description, item.afterCompletion] : [item.description];
               const align = descriptions.length > 1 ? 'spacebetween' : 'left';

               quickPrint('  ' + strJustify(descriptions, listDisplayWidth, {
                  align,
               }));
               quickPrint(`  ${bar}\n`);
            }
         }
      } else {
         const cardWidth = 38;
         const blocks = achievements.map((item) => {
            const goal = item.nextGoal ? item.nextGoal : undefined;
            const compactProgress =
               goal != null
                  ? `${Math.min(item.progress, goal)}/${goal}`
                  : item.tier > 0
                     ? 'done'
                     : `${item.progress}`;

            return panel(
               achievementLabel(item),
               `${ncc('Dim')}${item.status} · ${compactProgress}${ncc()}\n` +
               strWrap(item.afterCompletion || item.description, cardWidth - 4),
               cardWidth
            );
         });

         quickPrint('');
         quickPrint(panelGrid(blocks, contentWidth, cardWidth));
      }

      await markAllAchievementsViewed();
      return 0;
   },
   help: {
      short: 'Show unlocked and locked achievements.',
      usage: 'yabsod achievements [-l|--list] [--updated|--unlocked|--locked] [-f|--filter <query>]',
      long: 'Displays achievements by status and progress, with optional fuzzy filtering.',
   },
};


export default cmd;
