import { ncc, strWrap } from '@lib/Tools';

import { CommandModule } from '@/common';
import { quickPrint } from '@/modules/shell';

const cmd: CommandModule = {
   async run(ctx) {
      const { commands } = await import('@/commands/index');
      const topic = ctx.args[0];
      if (topic && topic !== 'help' && commands[topic]) {
         const target = commands[topic];
         quickPrint(`${ncc('Bright')}${ncc('Cyan')}yabsod ${topic}${ncc()}`);
         quickPrint(`  ${target.help.short}`);
         quickPrint(`  usage: ${target.help.usage}`);
         if (target.help.long) {
            quickPrint('');
            quickPrint(strWrap(target.help.long, Math.max(60, (process.stdout.columns || 100) - 2)));
         }
         return 0;
      }

      quickPrint(`${ncc('Bright')}${ncc('Cyan')}YABSOD${ncc()} - Yet Another Blue Screen of Death`);
      quickPrint('\nUsage:');
      quickPrint('  yabsod <command> [options]');
      quickPrint('\nCommands:');

      for (const [name, mod] of Object.entries(commands)) {
         if (name === 'help') continue;
         quickPrint(`  ${ncc('Yellow')}${name.padEnd(14)}${ncc()} ${mod.help.short}`);
      }

      quickPrint('  help           Show command help');
      quickPrint('\nExamples:');
      quickPrint('  yabsod jot --background');
      quickPrint('  yabsod stats --range month');
      quickPrint('  yabsod achievements --updated');
      quickPrint('  yabsod list --since 30d --bsod');
      quickPrint('  yabsod view ~1 --format md');
      quickPrint('\nTip: yabsod help <command> for command-specific usage.');
      return 0;
   },
   help: {
      short: 'Show general or command-specific help.',
      usage: 'yabsod help [command]',
      long: 'Lists available commands and examples. Pass a command name to show detailed usage.',
   },
};

export default cmd;
