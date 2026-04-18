export class ArgSet extends Array<string> {
   static get [Symbol.species](): ArrayConstructor {
      return Array;
   }

   constructor(args: string[] | number = []) {
      if (Array.isArray(args)) {
         super(...args);
      } else {
         super(args);
      }
   }

   hasAny(...options: string[]): boolean {
      return options.some((option) => this.includes(option));
   }

   optionIndexOf(option: string, from = 0): number {
      const terminatorIdx = this.indexOf('--');
      const end = terminatorIdx === -1 ? this.length : terminatorIdx;

      for (let i = from; i < end; i++) {
         const token = this[i];
         if (token === option || token.startsWith(option + '=')) {
            return i;
         }
      }

      return -1;
   }

   popOption(...options: string[]): string | null {
      for (const option of options) {
         const index = this.optionIndexOf(option);
         if (index !== -1) {
            return this.splice(index, 1)[0] ?? null;
         }
      }

      return null;
   }

   popValue(...options: string[]): string | null {
      for (const option of options) {
         const index = this.optionIndexOf(option);
         if (index === -1) continue;

         const token = this[index] ?? '';
         if (token.includes('=')) {
            const value = token.slice(token.indexOf('=') + 1);
            this.splice(index, 1);
            return value;
         }

         const next = this[index + 1];
         if (next != null && next !== '--' && !next.startsWith('-')) {
            this.splice(index, 2);
            return next;
         }

         this.splice(index, 1);
         return null;
      }

      return null;
   }

   toArray(): string[] {
      return [...this];
   }
}

export interface TimeFilter {
   since?: number;
   until?: number;
}

export function parseTimeFilter(args: ArgSet): TimeFilter {
   const sinceRaw =
      args.popValue('--since') ?? args.popValue('--after') ?? args.popValue('--from') ?? undefined;
   const untilRaw =
      args.popValue('--until') ?? args.popValue('--before') ?? args.popValue('--to') ?? undefined;

   return {
      since: parseDateLike(sinceRaw),
      until: parseDateLike(untilRaw),
   };
}

export function parseDateLike(value?: string | null): number | undefined {
   if (!value) return undefined;

   const now = Date.now();
   const lower = value.toLowerCase();
   const rel = lower.match(/^(\d+)([smhdwMy])$/i);
   if (rel) {
      const amount = Number(rel[1]);
      const unit = rel[2].toLowerCase();
      const factor =
         unit === 's'
            ? 1000
            : unit === 'm'
              ? 60_000
              : unit === 'h'
                ? 3_600_000
                : unit === 'd'
                  ? 86_400_000
                  : unit === 'w'
                    ? 7 * 86_400_000
                    : unit === 'y'
                      ? 365 * 86_400_000
                      : 30 * 86_400_000;
      return now - amount * factor;
   }

   const parsed = Date.parse(value);
   if (Number.isNaN(parsed)) return undefined;
   return parsed;
}

export function parseLimit(args: ArgSet, fallback = 50): number {
   const raw = args.popValue('-n') ?? args.popValue('--max-count') ?? args.popValue('--limit');
   if (!raw) return fallback;
   const num = Number(raw);
   if (!Number.isFinite(num) || num <= 0) return fallback;
   return Math.floor(num);
}
