import { describe, expect, it } from 'bun:test';

import { quoteForCrashCount } from '@/modules/quotes';

describe('quoteForCrashCount', () => {
   it('returns stable quote for zero crashes', () => {
      expect(quoteForCrashCount(0)).toContain('boring');
   });

   it('returns high-tier quote for large counts', () => {
      expect(quoteForCrashCount(100)).toContain('Legendary');
   });
});
