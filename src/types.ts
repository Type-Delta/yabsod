import type { z } from 'zod';

import { BugCheckReferenceEntrySchema } from '@/schemas';

export type CrashType = 'bsod' | 'app';

export type TimeRange = 'week' | 'month' | 'all-time';

export interface CrashEventInput {
   hashId: string;
   timestamp: number;
   crashType: CrashType;
   applicationName?: string | null;
   bugCheckCode?: string | null;
   bugCheckName?: string | null;
   processName?: string | null;
   reportId?: string | null;
   reportStatus?: string | null;
   stackTrace?: string | null;
   dumpPaths?: string[];
   relatedEventLogs?: string[];
   osVersion?: string | null;
   osBuild?: string | null;
   driverVersion?: string | null;
   rawPayload?: string | null;
}

export interface StatsSummary {
   totalToday: number;
   totalWeek: number;
   totalMonth: number;
   totalAllTime: number;
   selectedRangeTotal: number;
   selectedRangeBsod: number;
   selectedRangeApp: number;
   daysSinceLastBsod: number;
   currentUptimeDays: number;
   longestUptimeDays: number;
   topHours: Array<{ hour: number; count: number }>;
   topApps: Array<{ label: string; count: number }>;
   topBugChecks: Array<{ label: string; count: number }>;
   topProcesses: Array<{ label: string; count: number }>;
   heatmapDays: Array<{ date: string; bsod: number; app: number }>;
}

export interface AchievementState {
   key: string;
   name: string;
   description: string;
   status: 'updated' | 'unlocked' | 'locked';
   tier: number;
   maxTier: number;
   progress: number;
   nextGoal?: number;
   currentGoal: number;
   afterCompletion?: string;
}

export type BugCheckReferenceEntry = z.infer<typeof BugCheckReferenceEntrySchema>;

export interface SpinnerOptions {
   /** Message to display next to the spinner */
   message?: string;
   /** Interval between spinner frames in milliseconds (default: 80) */
   interval?: number;
   /** Spinner characters to cycle through */
   frames?: string[];
}
