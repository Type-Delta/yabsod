import { ncc, strWrap } from '@lib/Tools';

import { CommandModule } from '@/common';
import { header, kv } from '@/modules/render';
import { contentWidth, quickPrint } from '@/modules/shell';
import { COLOR_PALETTE } from '@/consts';

const cmd: CommandModule = {
   async run(ctx) {
      const { commands } = await import('@/commands/index');
      const topic = ctx.args[0];
      if (topic && topic !== 'help' && commands[topic]) {
         const target = commands[topic];
         quickPrint('');
         quickPrint(header(`yabsod ${topic}`));
         quickPrint('');
         quickPrint(kv([
            ['about', target.help.short],
            ['usage', target.help.usage],
         ], '  '));
         if (target.help.long) {
            quickPrint('');
            quickPrint(strWrap(target.help.long, Math.max(60, contentWidth - 2)));
         }
         return 0;
      }

      quickPrint('');
      quickPrint(`  ${ncc('Bright')}YABSOD${ncc()} ${ncc('Dim')}· Yet Another Blue Screen of Death${ncc()}`);
      quickPrint('');
      quickPrint(header('Usage'));
      quickPrint('');
      quickPrint(`  yabsod ${ncc(COLOR_PALETTE.teal300)}<command>${ncc()} ${ncc('Dim')}[options]${ncc()}`);
      quickPrint('');
      quickPrint(header('Commands'));
      quickPrint('');

      for (const [name, mod] of Object.entries(commands)) {
         if (name === 'help') continue;
         quickPrint(`  ${ncc(COLOR_PALETTE.teal300)}${name.padEnd(14)}${ncc()} ${mod.help.short}`);
      }

      quickPrint(`  ${ncc(COLOR_PALETTE.teal300)}${'help'.padEnd(14)}${ncc()} Show command help`);
      quickPrint('');
      quickPrint(header('Examples'));
      quickPrint('');
      quickPrint(`  yabsod jot --background`);
      quickPrint(`  yabsod stats --range month`);
      quickPrint(`  yabsod achievements --updated`);
      quickPrint(`  yabsod list --since 30d --bsod`);
      quickPrint(`  yabsod view ~1 --format md`);
      quickPrint('');
      quickPrint(`  ${ncc('Dim')}yabsod help <command> for command-specific usage.${ncc()}`);
      return 0;
   },
   help: {
      short: 'Show general or command-specific help.',
      usage: 'yabsod help [command]',
      long: 'Lists available commands and examples. Pass a command name to show detailed usage.',
   },
};

export default cmd;
