export const SARCASTIC_QUOTES = [
   {
      min: 0,
      max: 0,
      text: 'No crashes? Kinda boring tbh. Did your PC even try today?',
   },
   {
      min: 1,
      max: 5,
      text: 'Cute numbers. Rookie tier instability.',
   },
   {
      min: 6,
      max: 20,
      text: 'Now we are talking. This machine has character.',
   },
   {
      min: 21,
      max: 80,
      text: 'Certified chaos engine. Respect.',
   },
   {
      min: 81,
      max: Number.POSITIVE_INFINITY,
      text: 'Legendary meltdown. This is no longer a PC, it is performance art.',
   },
];

export function quoteForCrashCount(total: number): string {
   const found = SARCASTIC_QUOTES.find((item) => total >= item.min && total <= item.max);
   return found?.text ?? 'Unexpected stability timeline.';
}
