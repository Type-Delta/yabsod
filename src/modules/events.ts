import { Repository } from 'typeorm';

import { CrashEventEntity } from '@/entities/CrashEvent';
import { crashRepo } from '@/modules/db';
import { toShortHashId } from '@/modules/ids';
import { CrashEventInput, StatsSummary, TimeRange } from '@/types';

export interface EventFilter {
   since?: number;
   until?: number;
   crashType?: 'bsod' | 'app';
   appName?: string;
   bugCheck?: string;
   limit?: number;
}

export interface UpsertResult {
   inserted: number;
   skipped: number;
   entries: CrashEventEntity[];
}

export async function upsertEvents(events: CrashEventInput[]): Promise<UpsertResult> {
   const repo = await crashRepo();

   let inserted = 0;
   let skipped = 0;
   const entries: CrashEventEntity[] = [];

   for (const event of events) {
      const exists = await repo.findOne({ where: { hashId: event.hashId } });
      if (exists) {
         skipped += 1;
         continue;
      }

      const shortId = await toShortHashId(event.hashId, repo);
      const created = repo.create({
         ...mapInputToEntity(event),
         hashId: event.hashId,
         shortId,
      });

      await repo.save(created);
      inserted += 1;
      entries.push(created);
   }

   return { inserted, skipped, entries };
}

export async function listEvents(filter: EventFilter = {}): Promise<CrashEventEntity[]> {
   const repo = await crashRepo();

   const where = buildWhere(filter);
   let qb = repo.createQueryBuilder('event').where(where.where, where.params);

   if (filter.appName) {
      qb = qb.andWhere('LOWER(event.applicationName) LIKE LOWER(:appName)', {
         appName: `%${filter.appName}%`,
      });
   }

   if (filter.bugCheck) {
      qb = qb.andWhere(
         '(LOWER(event.bugCheckCode) LIKE LOWER(:bug) OR LOWER(event.bugCheckName) LIKE LOWER(:bug))',
         {
            bug: `%${filter.bugCheck}%`,
         }
      );
   }

   qb = qb.orderBy('event.timestamp', 'DESC');

   if (filter.limit && filter.limit > 0) {
      qb = qb.limit(filter.limit);
   }

   return qb.getMany();
}

export async function resolveEventById(input: string): Promise<CrashEventEntity | null> {
   const repo = await crashRepo();

   if (/^~\d+$/.test(input)) {
      const index = Number(input.slice(1));
      if (!Number.isFinite(index) || index <= 0) return null;

      const row = await repo
         .createQueryBuilder('event')
         .orderBy('event.timestamp', 'DESC')
         .offset(index - 1)
         .limit(1)
         .getOne();

      return row ?? null;
   }

   const exact = await repo.findOne({ where: [{ shortId: input }, { hashId: input }] });
   if (exact) return exact;

   const matches = await repo
      .createQueryBuilder('event')
      .where('event.hashId LIKE :prefix', { prefix: `${input}%` })
      .orderBy('event.timestamp', 'DESC')
      .limit(2)
      .getMany();

   if (matches.length === 1) return matches[0];
   return null;
}

export async function getAllEvents(
   repo?: Repository<CrashEventEntity>
): Promise<CrashEventEntity[]> {
   const targetRepo = repo ?? (await crashRepo());
   return targetRepo.find({ order: { timestamp: 'ASC' } });
}

export async function summarizeStats(range: TimeRange): Promise<StatsSummary> {
   const repo = await crashRepo();
   const events = await getAllEvents(repo);
   const now = Date.now();
   const dayMs = 86_400_000;

   const startWeek = now - 7 * dayMs;
   const startMonth = now - 30 * dayMs;
   const rangeStart =
      range === 'week' ? startWeek : range === 'month' ? startMonth : Number.NEGATIVE_INFINITY;

   const selected = events.filter((event) => event.timestamp >= rangeStart);

   const summary: StatsSummary = {
      totalToday: countBetween(events, now - dayMs, now),
      totalWeek: countBetween(events, startWeek, now),
      totalMonth: countBetween(events, startMonth, now),
      totalAllTime: events.length,
      selectedRangeTotal: selected.length,
      selectedRangeBsod: selected.filter((event) => event.crashType === 'bsod').length,
      selectedRangeApp: selected.filter((event) => event.crashType === 'app').length,
      daysSinceLastBsod: calcDaysSinceLastBsod(events, now),
      currentUptimeDays: calcCurrentUptime(events, now),
      longestUptimeDays: calcLongestUptime(events, now),
      topHours: topHours(selected),
      topApps: topCounts(
         selected
            .filter((event) => event.crashType === 'app')
            .map((event) => event.applicationName || 'UnknownApp'),
         3
      ),
      topBugChecks: topCounts(
         selected
            .filter((event) => event.crashType === 'bsod')
            .map((event) => event.bugCheckName || event.bugCheckCode || 'UnknownBugCheck'),
         3
      ),
      topProcesses: topCounts(
         selected
            .filter((event) => event.crashType === 'bsod')
            .map((event) => event.processName || 'UnknownProcess'),
         3
      ),
      heatmapDays: buildHeatmap(events, now),
   };

   return summary;
}

function buildWhere(filter: EventFilter): { where: string; params: Record<string, unknown> } {
   const clauses: string[] = ['1=1'];
   const params: Record<string, unknown> = {};

   if (filter.crashType) {
      clauses.push('event.crashType = :crashType');
      params.crashType = filter.crashType;
   }

   if (filter.since != null) {
      clauses.push('event.timestamp >= :since');
      params.since = filter.since;
   }

   if (filter.until != null) {
      clauses.push('event.timestamp <= :until');
      params.until = filter.until;
   }

   return {
      where: clauses.join(' AND '),
      params,
   };
}

function countBetween(events: CrashEventEntity[], since: number, until: number): number {
   return events.filter((event) => event.timestamp >= since && event.timestamp <= until).length;
}

function calcDaysSinceLastBsod(events: CrashEventEntity[], now: number): number {
   for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].crashType === 'bsod') {
         return Math.floor((now - events[i].timestamp) / 86_400_000);
      }
   }
   return -1;
}

function calcCurrentUptime(events: CrashEventEntity[], now: number): number {
   if (events.length === 0) return 0;
   const last = events[events.length - 1];
   return Math.floor((now - last.timestamp) / 86_400_000);
}

function calcLongestUptime(events: CrashEventEntity[], now: number): number {
   if (events.length === 0) return 0;

   let best = 0;
   for (let i = 0; i < events.length - 1; i++) {
      const gap = events[i + 1].timestamp - events[i].timestamp;
      best = Math.max(best, Math.floor(gap / 86_400_000));
   }

   const tailGap = now - events[events.length - 1].timestamp;
   best = Math.max(best, Math.floor(tailGap / 86_400_000));
   return best;
}

function topHours(events: CrashEventEntity[]): Array<{ hour: number; count: number }> {
   const map = new Map<number, number>();
   for (const event of events) {
      const hour = new Date(event.timestamp).getHours();
      map.set(hour, (map.get(hour) ?? 0) + 1);
   }

   return [...map.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
}

function topCounts(labels: string[], limit: number): Array<{ label: string; count: number }> {
   const map = new Map<string, number>();
   for (const label of labels) {
      map.set(label, (map.get(label) ?? 0) + 1);
   }

   return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
}

function buildHeatmap(events: CrashEventEntity[], now: number) {
   const dayMs = 86_400_000;
   const startDays = 365;
   const start = new Date(now - startDays * dayMs);
   start.setHours(0, 0, 0, 0);

   const map = new Map<string, { date: string; bsod: number; app: number }>();

   for (let offset = 0; offset <= startDays; offset++) {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);
      const key = date.toISOString().slice(0, 10);
      map.set(key, { date: key, bsod: 0, app: 0 });
   }

   for (const event of events) {
      const key = new Date(event.timestamp).toISOString().slice(0, 10);
      const bucket = map.get(key);
      if (!bucket) continue;
      if (event.crashType === 'bsod') bucket.bsod += 1;
      else bucket.app += 1;
   }

   return [...map.values()];
}

function mapInputToEntity(event: CrashEventInput): Omit<CrashEventEntity, 'id'> {
   return {
      hashId: event.hashId,
      shortId: event.hashId.slice(0, 4),
      timestamp: event.timestamp,
      crashType: event.crashType,
      applicationName: event.applicationName ?? null,
      bugCheckCode: event.bugCheckCode ?? null,
      bugCheckName: event.bugCheckName ?? null,
      processName: event.processName ?? null,
      reportId: event.reportId ?? null,
      reportStatus: event.reportStatus ?? null,
      stackTrace: event.stackTrace ?? null,
      dumpPaths: event.dumpPaths ?? null,
      relatedEventLogs: event.relatedEventLogs ?? null,
      osVersion: event.osVersion ?? null,
      osBuild: event.osBuild ?? null,
      driverVersion: event.driverVersion ?? null,
      rawPayload: event.rawPayload ?? null,
      source: 'eventlog',
   };
}
