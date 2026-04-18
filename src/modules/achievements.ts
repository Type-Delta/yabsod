import { search } from '@lib/Tools';

import { AchievementEntity } from '@/entities/Achievement';
import { achievementRepo } from '@/modules/db';
import { getAllEvents } from '@/modules/events';
import { AchievementState } from '@/types';

interface Definition {
   key: string;
   name: string;
   tiers: number[];
   description: (tier: number, goal: number) => string;
   progress: (ctx: EvalContext) => number;
   afterCompletion?: (ctx: EvalContext) => string;
}

interface EvalContext {
   totalBsod: number;
   totalCrashes: number;
   maxBsodInMonth: number;
   maxAppInMonthByName: { name: string; count: number };
   uniqueBugChecks: number;
   bsodsIn10MinMax: number;
   bsodsOn13thMax: number;
   maxNoBsodStreakDays: number;
   bugcheckHitSet: Set<string>;
   nvidiaMonthMax: number;
}

const DEFINITIONS: Definition[] = [
   {
      key: 'patience',
      name: 'Patience',
      tiers: [5, 10, 20],
      description: (_, goal) => `Reach ${goal}+ BSODs in a month`,
      progress: (ctx) => ctx.maxBsodInMonth,
      afterCompletion: (ctx) => `Best month: ${ctx.maxBsodInMonth} BSODs`,
   },
   {
      key: 'shower_me_in_blue',
      name: 'Shower Me in Blue',
      tiers: [10, 50, 150, 400],
      description: (_, goal) => `Total BSODs ${goal}+`,
      progress: (ctx) => ctx.totalBsod,
      afterCompletion: (ctx) => `Total BSODs: ${ctx.totalBsod}`,
   },
   {
      key: 'stability_is_for_weaklings',
      name: 'Stability is for weaklings!',
      tiers: [100, 200, 500],
      description: (_, goal) => `Total crashes ${goal}+`,
      progress: (ctx) => ctx.totalCrashes,
      afterCompletion: (ctx) => `Total crashes: ${ctx.totalCrashes}`,
   },
   {
      key: 'gotta_catch_em_all',
      name: 'Gotta Catch Em All',
      tiers: [5, 10, 20],
      description: (_, goal) => `Unique BugChecks ${goal}+`,
      progress: (ctx) => ctx.uniqueBugChecks,
      afterCompletion: (ctx) => `Unique BugChecks: ${ctx.uniqueBugChecks}`,
   },
   {
      key: 'vacation_demanded',
      name: 'Vacation Demanded!',
      tiers: [2],
      description: () => '2+ BSODs within 10 minutes',
      progress: (ctx) => ctx.bsodsIn10MinMax,
      afterCompletion: (ctx) => `Peak 10-min BSOD burst: ${ctx.bsodsIn10MinMax}`,
   },
   {
      key: 'bad_13',
      name: 'Bad 13',
      tiers: [2],
      description: () => '2+ BSODs on any 13th day',
      progress: (ctx) => ctx.bsodsOn13thMax,
      afterCompletion: (ctx) => `Worst 13th day: ${ctx.bsodsOn13thMax} BSODs`,
   },
   {
      key: 'technologia',
      name: 'Technologia!',
      tiers: [5, 10, 20],
      description: (_, goal) => `One app crashed ${goal}+ times in a month`,
      progress: (ctx) => ctx.maxAppInMonthByName.count,
      afterCompletion: (ctx) =>
         ctx.maxAppInMonthByName.name
            ? `${ctx.maxAppInMonthByName.name}: ${ctx.maxAppInMonthByName.count}`
            : 'No app crash peak yet',
   },
   {
      key: 'its_nvidia',
      name: "It's NVIDIA",
      tiers: [5, 10, 20],
      description: (_, goal) => `${goal}+ NVIDIA BSODs in a month`,
      progress: (ctx) => ctx.nvidiaMonthMax,
      afterCompletion: (ctx) => `Worst NVIDIA month: ${ctx.nvidiaMonthMax}`,
   },
   {
      key: 'self_destruct',
      name: 'Self Destruct',
      tiers: [1],
      description: () => 'See MANUALLY_INITIATED_CRASH1 once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('MANUALLY_INITIATED_CRASH1') ? 1 : 0),
   },
   {
      key: 'his_name_was_null',
      name: "His name was 'NULL'",
      tiers: [1],
      description: () => 'See WINLOGON_FATAL_ERROR once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('WINLOGON_FATAL_ERROR') ? 1 : 0),
   },
   {
      key: 'plank_frames_per_second',
      name: 'Plank Frames Per Second',
      tiers: [1],
      description: () => 'See VIDEO_TDR_FAILURE once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('VIDEO_TDR_FAILURE') ? 1 : 0),
   },
   {
      key: 'out_of_paper',
      name: 'Out of Paper',
      tiers: [1],
      description: () => 'See PAGE_FAULT_IN_NONPAGED_AREA once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('PAGE_FAULT_IN_NONPAGED_AREA') ? 1 : 0),
   },
   {
      key: 'the_dog_was_impatience',
      name: 'The dog was a bit impatience',
      tiers: [1],
      description: () => 'See DPC_WATCHDOG_VIOLATION once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('DPC_WATCHDOG_VIOLATION') ? 1 : 0),
   },
   {
      key: 'mayday',
      name: 'MAYDAY MAYDAY!',
      tiers: [1],
      description: () => 'See CRITICAL_PROCESS_DIED once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('CRITICAL_PROCESS_DIED') ? 1 : 0),
   },
   {
      key: 'out_of_service',
      name: 'Out of Service',
      tiers: [1],
      description: () => 'See SYSTEM_SERVICE_EXCEPTION once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('SYSTEM_SERVICE_EXCEPTION') ? 1 : 0),
   },
   {
      key: 'no_mom_dont_pull_the_plug',
      name: "NO MOM! Don't pull the plug!",
      tiers: [1],
      description: () => 'See WHEA_UNCORRECTABLE_ERROR once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('WHEA_UNCORRECTABLE_ERROR') ? 1 : 0),
   },
   {
      key: 'its_not_writeable',
      name: "It's not writeable?",
      tiers: [1],
      description: () => 'See any write-related BugCheck once',
      progress: (ctx) =>
         [
            'IRQL_NOT_LESS_OR_EQUAL',
            'DRIVER_IRQL_NOT_LESS_OR_EQUAL',
            'ATTEMPTED_EXECUTE_OF_NOEXECUTE_MEMORY',
            'ATTEMPTED_WRITE_TO_CM_PROTECTED_STORAGE',
            'ATTEMPTED_WRITE_TO_READONLY_MEMORY',
         ].some((name) => ctx.bugcheckHitSet.has(name))
            ? 1
            : 0,
   },
   {
      key: 'confusion',
      name: 'Confusion',
      tiers: [1],
      description: () => 'See IRQL_UNEXPECTED_VALUE once',
      progress: (ctx) => (ctx.bugcheckHitSet.has('IRQL_UNEXPECTED_VALUE') ? 1 : 0),
   },
   {
      key: 'fasting',
      name: 'Fasting',
      tiers: [30, 172, 365],
      description: (_, goal) => `${goal}+ days without BSOD`,
      progress: (ctx) => ctx.maxNoBsodStreakDays,
      afterCompletion: (ctx) => `Best no-BSOD streak: ${ctx.maxNoBsodStreakDays} days`,
   },
];

export async function evaluateAndUnlockAchievements(): Promise<{
   newlyUnlocked: AchievementEntity[];
}> {
   const repo = await achievementRepo();
   const context = await buildEvalContext();
   const now = Date.now();

   const unlocked: AchievementEntity[] = [];

   for (const def of DEFINITIONS) {
      const progress = def.progress(context);
      const tier = highestTier(progress, def.tiers);
      if (tier <= 0) continue;

      const key = `${def.key}:t${tier}`;
      const existed = await repo.findOne({ where: { key } });
      if (existed) {
         const shouldUpdateAfter = def.afterCompletion ? def.afterCompletion(context) : null;
         if (shouldUpdateAfter !== existed.afterCompletion) {
            existed.afterCompletion = shouldUpdateAfter;
            existed.updatedAt = now;
            await repo.save(existed);
         }
         continue;
      }

      const goal = def.tiers[tier - 1];
      const achievement = repo.create({
         key,
         tier,
         name: def.name,
         description: def.description(tier, goal),
         icon: '',
         unlockedAt: now,
         updatedAt: now,
         viewed: false,
         afterCompletion: def.afterCompletion ? def.afterCompletion(context) : null,
      });

      await repo.save(achievement);
      unlocked.push(achievement);
   }

   return { newlyUnlocked: unlocked };
}

export async function markAllAchievementsViewed(): Promise<void> {
   const repo = await achievementRepo();
   const pending = await repo.find({ where: { viewed: false } });
   if (pending.length === 0) return;

   for (const item of pending) {
      item.viewed = true;
   }
   await repo.save(pending);
}

export async function listAchievementStates(options?: {
   filter?: string;
   status?: 'updated' | 'unlocked' | 'locked';
}): Promise<AchievementState[]> {
   const repo = await achievementRepo();
   const unlocked = await repo.find({ order: { updatedAt: 'DESC' } });
   const context = await buildEvalContext();

   const unlockedByKey = new Map<string, AchievementEntity>();
   for (const item of unlocked) {
      const base = item.key.split(':')[0];
      const existed = unlockedByKey.get(base);
      if (!existed || item.tier > existed.tier) {
         unlockedByKey.set(base, item);
      }
   }

   const states: AchievementState[] = DEFINITIONS.map((def) => {
      const achieved = unlockedByKey.get(def.key);
      const progress = def.progress(context);
      const tier = achieved?.tier ?? 0;
      const maxTier = def.tiers.length;
      const nextGoal = tier >= maxTier ? undefined : String(def.tiers[tier]);
      const afterCompletion = achieved?.afterCompletion ?? undefined;
      const status = classifyAchievementStatus(
         {
            key: def.key,
            name: def.name,
            description: '',
            status: 'locked',
            tier,
            maxTier,
            progress,
         },
         achieved
      );

      return {
         key: def.key,
         name: def.name,
         description: def.description(
            Math.max(1, tier + 1),
            def.tiers[Math.min(tier, maxTier - 1)]
         ),
         status,
         tier,
         maxTier,
         progress,
         nextGoal,
         afterCompletion,
      };
   });

   const filtered = applyFilters(states, unlockedByKey, options);
   return filtered;
}

export function classifyAchievementStatus(
   state: AchievementState,
   unlockedEntity?: AchievementEntity
): 'updated' | 'unlocked' | 'locked' {
   if (!unlockedEntity && state.tier <= 0) return 'locked';

   if (!unlockedEntity) return 'unlocked';
   const weekMs = 7 * 86_400_000;
   if (Date.now() - unlockedEntity.updatedAt <= weekMs || !unlockedEntity.viewed) {
      return 'updated';
   }
   return 'unlocked';
}

export function tierLabel(current: number): string {
   const roman = ['I', 'II', 'III', 'IV', 'V'];
   const targetTier = Math.max(1, current > 0 ? current : 1);
   const suffix = roman[targetTier - 1] ?? String(targetTier);
   return ` ${suffix}`;
}

async function buildEvalContext(): Promise<EvalContext> {
   const events = await getAllEvents();

   const bsods = events.filter((event) => event.crashType === 'bsod');
   const apps = events.filter((event) => event.crashType === 'app');

   const monthlyBsod = new Map<string, number>();
   const monthlyAppByName = new Map<string, number>();
   const bsodBy13th = new Map<string, number>();
   const nvidiaMonthMap = new Map<string, number>();

   for (const event of bsods) {
      const date = new Date(event.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyBsod.set(monthKey, (monthlyBsod.get(monthKey) ?? 0) + 1);

      if (date.getDate() === 13) {
         const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
         bsodBy13th.set(dayKey, (bsodBy13th.get(dayKey) ?? 0) + 1);
      }

      if ((event.processName ?? '').toLowerCase().includes('nvidia')) {
         nvidiaMonthMap.set(monthKey, (nvidiaMonthMap.get(monthKey) ?? 0) + 1);
      }
   }

   for (const event of apps) {
      const date = new Date(event.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const appName = event.applicationName || 'UnknownApp';
      const key = `${monthKey}|${appName}`;
      monthlyAppByName.set(key, (monthlyAppByName.get(key) ?? 0) + 1);
   }

   const maxBsodInMonth = Math.max(0, ...monthlyBsod.values());
   const maxAppInMonth = [...monthlyAppByName.entries()].sort((a, b) => b[1] - a[1])[0];
   const maxAppInMonthByName = maxAppInMonth
      ? {
         name: maxAppInMonth[0].split('|')[1],
         count: maxAppInMonth[1],
      }
      : { name: '', count: 0 };

   const bsodTimes = bsods.map((event) => event.timestamp).sort((a, b) => a - b);
   const bsodsIn10MinMax = maxWithinWindow(bsodTimes, 10 * 60 * 1000);
   const bsodsOn13thMax = Math.max(0, ...bsodBy13th.values());
   const bugcheckHitSet = new Set(
      bsods.map((event) => event.bugCheckName || event.bugCheckCode || '').filter(Boolean)
   );
   const maxNoBsodStreakDays = longestNoBsodStreak(bsodTimes);

   return {
      totalBsod: bsods.length,
      totalCrashes: events.length,
      maxBsodInMonth,
      maxAppInMonthByName,
      uniqueBugChecks: bugcheckHitSet.size,
      bsodsIn10MinMax,
      bsodsOn13thMax,
      maxNoBsodStreakDays,
      bugcheckHitSet,
      nvidiaMonthMax: Math.max(0, ...nvidiaMonthMap.values()),
   };
}

function highestTier(progress: number, tiers: number[]): number {
   let tier = 0;
   for (let i = 0; i < tiers.length; i++) {
      if (progress >= tiers[i]) tier = i + 1;
   }
   return tier;
}

function maxWithinWindow(values: number[], windowMs: number): number {
   if (values.length === 0) return 0;

   let max = 1;
   let left = 0;
   for (let right = 0; right < values.length; right++) {
      while (values[right] - values[left] > windowMs) {
         left += 1;
      }
      max = Math.max(max, right - left + 1);
   }

   return max;
}

function longestNoBsodStreak(bsodTimes: number[]): number {
   if (bsodTimes.length === 0) return 0;
   let best = 0;
   for (let i = 0; i < bsodTimes.length - 1; i++) {
      const gap = bsodTimes[i + 1] - bsodTimes[i];
      best = Math.max(best, Math.floor(gap / 86_400_000));
   }

   const tail = Date.now() - bsodTimes[bsodTimes.length - 1];
   best = Math.max(best, Math.floor(tail / 86_400_000));
   return best;
}

function applyFilters(
   states: AchievementState[],
   _unlockedByKey: Map<string, AchievementEntity>,
   options?: {
      filter?: string;
      status?: 'updated' | 'unlocked' | 'locked';
   }
): AchievementState[] {
   let filtered = [...states];

   if (options?.status) {
      filtered = filtered.filter((state) => {
         return state.status === options.status;
      });
   }

   const query = options?.filter?.trim();
   if (query) {
      const haystack = filtered.map((item) => `${item.name} ${item.description}`);
      const results = search(haystack, query, { maxResult: filtered.length }) ?? [];
      const selected = new Set(results.map((item) => item.matchIndex));
      filtered = filtered.filter((_, idx) => selected.has(idx));
   }

   return filtered;
}
