import crypto from 'node:crypto';

import { CrashEventInput } from '../types';

export function hashCrashEvent(input: Omit<CrashEventInput, 'hashId'>): string {
   const stable = {
      ts: input.timestamp,
      t: input.crashType,
      app: input.applicationName ?? '',
      bug: normalizeBugCheckCode(input.bugCheckCode),
      bugName: normalizeBugCheckName(input.bugCheckName),
      proc: input.processName ?? '',
      report: input.reportId ?? '',
   };

   return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function normalizeBugCheckCode(code?: string | null): string {
   if (!code) return '';
   const raw = code.trim();
   if (!raw) return '';

   if (raw.startsWith('0x') || raw.startsWith('0X')) {
      const numeric = Number.parseInt(raw.slice(2), 16);
      if (Number.isNaN(numeric)) return raw.toUpperCase();
      return `0x${numeric.toString(16).toUpperCase()}`;
   }

   const decimal = Number.parseInt(raw, 10);
   if (Number.isNaN(decimal)) return raw.toUpperCase();
   return `0x${decimal.toString(16).toUpperCase()}`;
}

export function normalizeBugCheckName(name?: string | null): string {
   if (!name) return '';
   return name
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/gi, '_')
      .toUpperCase();
}
