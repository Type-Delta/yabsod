import { ArgSet } from '@/modules/args';

export interface CliContext {
   args: ArgSet;
   rawArgs: string[];
}

export interface CommandModule {
   run(ctx: CliContext): Promise<number>;
   help: {
      short: string;
      usage: string;
      long?: string;
   };
}
