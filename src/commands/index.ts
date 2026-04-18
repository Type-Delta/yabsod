import { CommandModule } from '@/common';

import achievements from '@/commands/achievements';
import help from '@/commands/help';
import jot from '@/commands/jot';
import list from '@/commands/list';
import stats from '@/commands/stats';
import view from '@/commands/view';

export const commands: Record<string, CommandModule> = {
   stats,
   jot,
   achievements,
   list,
   view,
   help,
};
