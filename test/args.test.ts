import { describe, expect, it } from 'bun:test';

import { ArgSet, parseDateLike } from '@/modules/args';

describe('ArgSet', () => {
   it('pops value from --flag=value style', () => {
      const args = new ArgSet(['--range=month']);
      expect(args.popValue('--range')).toBe('month');
      expect(args.length).toBe(0);
   });

   it('pops value from separated tokens', () => {
      const args = new ArgSet(['--range', 'all-time', '--x']);
      expect(args.popValue('--range')).toBe('all-time');
      expect(args.toArray()).toEqual(['--x']);
   });
});

describe('parseDateLike', () => {
   it('parses relative days', () => {
      const now = Date.now();
      const value = parseDateLike('7d');
      expect(typeof value).toBe('number');
      expect(now - (value || 0)).toBeGreaterThan(6.5 * 86_400_000);
   });

   it('parses absolute date strings', () => {
      const value = parseDateLike('2025-01-01T00:00:00Z');
      expect(value).toBe(Date.parse('2025-01-01T00:00:00Z'));
   });
});
