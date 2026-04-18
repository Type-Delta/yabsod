import { describe, expect, it } from 'bun:test';

import { hashCrashEvent, normalizeBugCheckCode, normalizeBugCheckName } from '@/modules/hash';

describe('hash module', () => {
   it('normalizes bugcheck codes consistently', () => {
      expect(normalizeBugCheckCode('0x00000116')).toBe('0x116');
      expect(normalizeBugCheckCode('278')).toBe('0x116');
      expect(normalizeBugCheckCode('')).toBe('');
   });

   it('normalizes bugcheck names', () => {
      expect(normalizeBugCheckName('Video Tdr Failure')).toBe('VIDEO_TDR_FAILURE');
   });

   it('creates deterministic crash hashes', () => {
      const input = {
         timestamp: 1_700_000_000_000,
         crashType: 'bsod' as const,
         bugCheckCode: '0x116',
         bugCheckName: 'VIDEO_TDR_FAILURE',
         processName: 'nvlddmkm.sys',
      };

      const a = hashCrashEvent(input);
      const b = hashCrashEvent(input);
      expect(a).toBe(b);
      expect(a.length).toBe(64);
   });
});
