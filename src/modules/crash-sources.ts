import fs from 'node:fs';
import path from 'node:path';

import { CrashEventInput } from '@/types';
import { hashCrashEvent, normalizeBugCheckCode, normalizeBugCheckName } from '@/modules/hash';
import { parsePwshDate, runPowerShellJson } from '@/modules/powershell';

interface EventRecord {
   TimeCreated?: string;
   ProviderName?: string;
   Id?: number;
   LevelDisplayName?: string;
   Message?: string;
}

interface ReliabilityRecord {
   TimeGenerated?: string;
   SourceName?: string;
   Message?: string;
}

export async function collectCrashEvents(background = false): Promise<CrashEventInput[]> {
   const [eventLog, reliability] = background
      ? [await readEventLogEvents(), await readReliabilityEvents()]
      : await Promise.all([readEventLogEvents(), readReliabilityEvents()]);

   const combined = [...eventLog, ...reliability];
   combined.sort((a, b) => a.timestamp - b.timestamp);
   return combined;
}

async function readEventLogEvents(): Promise<CrashEventInput[]> {
   const script = [
      `$records = Get-WinEvent -FilterHashtable @{LogName='System'; ID=41,1001} -MaxEvents 5000 -ErrorAction SilentlyContinue |`,
      'Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, Message;',
      '$records | ConvertTo-Json -Depth 4',
   ].join(' ');

   const data = await runPowerShellJson<EventRecord[] | EventRecord>(script);
   const records = normalizeToArray(data);

   const results: CrashEventInput[] = [];
   for (const record of records) {
      const timestamp = record.TimeCreated ? parsePwshDate(record.TimeCreated)?.getTime() : null;
      if (!timestamp) continue;

      const message = record.Message ?? '';
      const provider = record.ProviderName ?? '';
      const isBugcheck =
         provider === 'Microsoft-Windows-WER-SystemErrorReporting' || /bugcheck/i.test(message);

      if (isBugcheck) {
         const parsed = parseBugcheckFromMessage(message);
         const draft: Omit<CrashEventInput, 'hashId'> = {
            timestamp,
            crashType: 'bsod',
            bugCheckCode: parsed.code,
            bugCheckName: parsed.name,
            processName: parsed.processName,
            reportId: parsed.reportId,
            reportStatus: null,
            stackTrace: null,
            dumpPaths: findDumpFilesNear(timestamp),
            relatedEventLogs: collectRelatedEventHints(record),
            osVersion: null,
            osBuild: null,
            driverVersion: null,
            rawPayload: message,
         };

         results.push({
            hashId: hashCrashEvent(draft),
            ...draft,
         });
         continue;
      }

      if (/kernel-power|unexpected shutdown|blue screen|bugcheck/i.test(message + ' ' + provider)) {
         const draft: Omit<CrashEventInput, 'hashId'> = {
            timestamp,
            crashType: 'bsod',
            bugCheckCode: null,
            bugCheckName: null,
            processName: null,
            reportId: null,
            reportStatus: null,
            stackTrace: null,
            dumpPaths: findDumpFilesNear(timestamp),
            relatedEventLogs: collectRelatedEventHints(record),
            osVersion: null,
            osBuild: null,
            driverVersion: null,
            rawPayload: message,
         };

         results.push({
            hashId: hashCrashEvent(draft),
            ...draft,
         });
      }
   }

   return dedupe(results);
}

async function readReliabilityEvents(): Promise<CrashEventInput[]> {
   const days = 365;
   const script = [
      '$start = (Get-Date).AddDays(-' + days + ');',
      'Get-CimInstance Win32_ReliabilityRecords -ErrorAction SilentlyContinue |',
      'Where-Object { $_.TimeGenerated -ge $start -and ($_.SourceName -match "Application Error|Windows Error Reporting|BlueScreen") } |',
      'Select-Object TimeGenerated, SourceName, Message |',
      'ConvertTo-Json -Depth 4',
   ].join(' ');

   const data = await runPowerShellJson<ReliabilityRecord[] | ReliabilityRecord>(script);
   const records = normalizeToArray(data);

   const results: CrashEventInput[] = [];
   for (const record of records) {
      const timestamp = record.TimeGenerated ? parsePwshDate(record.TimeGenerated)?.getTime() : null;
      if (!timestamp) continue;

      const source = record.SourceName ?? '';
      const message = record.Message ?? '';
      const isApp = /application error|appcrash|stopped working/i.test(source + ' ' + message);
      const isBlue = /bluescreen|bugcheck/i.test(source + ' ' + message);

      if (isBlue) {
         const parsed = parseBugcheckFromMessage(message);
         const draft: Omit<CrashEventInput, 'hashId'> = {
            timestamp,
            crashType: 'bsod',
            bugCheckCode: parsed.code,
            bugCheckName: parsed.name,
            processName: parsed.processName,
            reportId: parsed.reportId,
            reportStatus: null,
            stackTrace: null,
            dumpPaths: findDumpFilesNear(timestamp),
            relatedEventLogs: [message],
            osVersion: null,
            osBuild: null,
            driverVersion: null,
            rawPayload: message,
         };
         results.push({ hashId: hashCrashEvent(draft), ...draft });
         continue;
      }

      if (isApp) {
         const appName = parseApplicationName(message);
         const draft: Omit<CrashEventInput, 'hashId'> = {
            timestamp,
            crashType: 'app',
            applicationName: appName,
            bugCheckCode: null,
            bugCheckName: null,
            processName: null,
            reportId: null,
            reportStatus: null,
            stackTrace: null,
            dumpPaths: nullToEmpty(findWerFoldersNear(timestamp)),
            relatedEventLogs: [message],
            osVersion: null,
            osBuild: null,
            driverVersion: null,
            rawPayload: message,
         };
         results.push({ hashId: hashCrashEvent(draft), ...draft });
      }
   }

   return dedupe(results);
}

function nullToEmpty(value: string[] | null): string[] {
   return value ?? [];
}

function normalizeToArray<T>(input: T[] | T | null): T[] {
   if (input == null) return [];
   return Array.isArray(input) ? input : [input];
}

function collectRelatedEventHints(record: EventRecord): string[] {
   const output: string[] = [];
   if (record.ProviderName) output.push(`provider=${record.ProviderName}`);
   if (record.Id != null) output.push(`eventId=${record.Id}`);
   if (record.LevelDisplayName) output.push(`level=${record.LevelDisplayName}`);
   if (record.Message) output.push(record.Message.slice(0, 2000));
   return output;
}

function parseBugcheckFromMessage(message: string): {
   code: string | null;
   name: string | null;
   processName: string | null;
   reportId: string | null;
} {
   const hex = message.match(/0x[0-9a-fA-F]+/);
   const code = hex ? normalizeBugCheckCode(hex[0]) : null;

   const nameMatch = message.match(/[A-Z][A-Z0-9_]{4,}/);
   const processMatch = message.match(/(?:caused by|process|module)\s*[:=]\s*([a-zA-Z0-9._-]+)/i);
   const reportIdMatch = message.match(/report\s*id\s*[:=]\s*([a-zA-Z0-9-]+)/i);

   return {
      code,
      name: nameMatch ? normalizeBugCheckName(nameMatch[0]) : null,
      processName: processMatch?.[1] ?? null,
      reportId: reportIdMatch?.[1] ?? null,
   };
}

function parseApplicationName(message: string): string {
   const patterns = [
      /application name\s*[:=]\s*([^,\n]+)/i,
      /faulting application name\s*[:=]\s*([^,\n]+)/i,
      /([a-zA-Z0-9._-]+\.exe)/i,
   ];

   for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match?.[1]) {
         return match[1].trim();
      }
   }

   return 'UnknownApp';
}

function findDumpFilesNear(timestamp: number): string[] {
   const result: string[] = [];
   const dumpDir = 'C:\\Windows\\Minidump';
   try {
      if (!fs.existsSync(dumpDir)) return result;
      const files = fs.readdirSync(dumpDir);
      for (const file of files) {
         const fullPath = path.join(dumpDir, file);
         const stat = fs.statSync(fullPath);
         if (Math.abs(stat.mtimeMs - timestamp) <= 48 * 60 * 60 * 1000) {
            result.push(fullPath);
         }
      }
   } catch {
      return result;
   }
   return result;
}

function findWerFoldersNear(timestamp: number): string[] | null {
   const roots = [
      path.join(
         process.env.ProgramData || 'C:\\ProgramData',
         'Microsoft',
         'Windows',
         'WER',
         'ReportQueue'
      ),
      path.join(
         process.env.ProgramData || 'C:\\ProgramData',
         'Microsoft',
         'Windows',
         'WER',
         'ReportArchive'
      ),
   ];

   const output: string[] = [];
   for (const root of roots) {
      try {
         if (!fs.existsSync(root)) continue;
         const entries = fs.readdirSync(root, { withFileTypes: true });
         for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const fullPath = path.join(root, entry.name);
            const stat = fs.statSync(fullPath);
            if (Math.abs(stat.mtimeMs - timestamp) <= 7 * 24 * 60 * 60 * 1000) {
               output.push(fullPath);
            }
         }
      } catch {
         continue;
      }
   }

   return output.length > 0 ? output : null;
}

function dedupe(events: CrashEventInput[]): CrashEventInput[] {
   const map = new Map<string, CrashEventInput>();
   for (const event of events) {
      if (!map.has(event.hashId)) {
         map.set(event.hashId, event);
      }
   }
   return [...map.values()];
}
