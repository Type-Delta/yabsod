import { ArgSet } from '@/modules/args';
import { closeDataSource } from '@/modules/db';
import { commands } from '@/commands/index';
import { CliContext } from '@/common';
import { error } from './modules/shell';

async function main(argv: string[]): Promise<number> {
   const ctx: CliContext = {
      args: new ArgSet(argv),
      rawArgs: argv,
   };

   const name = ctx.args.shift();
   const commandName = name || 'help';
   const command = commands[commandName];

   if (!command) {
      error(`Unknown command: ${commandName}`);
      error('Run `yabsod help` to see available commands.');
      return 1;
   }

   return command.run(ctx);
}

(async () => {
   try {
      const code = await main(process.argv.slice(2));
      await closeDataSource();
      process.exit(code);
   } catch (err) {
      const message = err instanceof Error ? err.stack || err.message : String(err);
      error(message);
      await closeDataSource();
      process.exit(1);
   }
})();
