import fs from 'node:fs';
import path from 'node:path';

import { CrashEventInput } from '@/types';
import { hashCrashEvent, normalizeBugCheckCode, normalizeBugCheckName } from '@/modules/hash';
import { getBugcheckInfo } from '@/modules/bugcheck-reference';
import { isAdministratorSession, parsePwshDate, runPowerShellJson } from '@/modules/powershell';

interface EventLogRecord {
   TimeCreated?: string;
   ProviderName?: string;
   Id?: number;
   LogName?: string;
   LevelDisplayName?: string;
   Message?: string;
   Properties?: Array<{ Value?: unknown }>;
}

interface WmiOsRecord {
   Version?: string;
   BuildNumber?: string;
}

interface WmiPnPSignedDriverRecord {
   DeviceName?: string;
   DriverName?: string;
   DriverVersion?: string;
   DriverDate?: string;
   Manufacturer?: string;
   DriverProviderName?: string;
   InfName?: string;
}

interface WerReportMetadata {
   eventType?: string | null;
   reportId?: string | null;
   reportStatus?: string | null;
   osVersion?: string | null;
   osBuild?: string | null;
   product?: string | null;
   bugCheckCode?: string | null;
   parameter1?: string | null;
   parameter2?: string | null;
   parameter3?: string | null;
   parameter4?: string | null;
   dumpPaths?: string[];
   processName?: string | null;
   applicationName?: string | null;
   moduleName?: string | null;
   exceptionCode?: string | null;
   stackTrace?: string | null;
}

interface DriverSnapshot {
   timestamp: number;
   value: string;
   driverName: string | null;
   driverVersion: string | null;
   deviceName: string | null;
   providerName: string | null;
   manufacturer: string | null;
   infName: string | null;
}

interface ReportIdPair {
   integratorReportId: string | null;
   reportIdentifier: string | null;
}

interface NormalizedCrashSeed {
   timestamp: number;
   crashType: 'bsod' | 'app';
   applicationName: string | null;
   bugCheckCode: string | null;
   bugCheckName: string | null;
   processName: string | null;
   reportId: string | null;
   reportStatus: string | null;
   stackTrace: string | null;
   dumpPaths: string[];
   relatedEventLogs: string[];
   osVersion: string | null;
   osBuild: string | null;
   driverVersion: string | null;
   rawPayload: string | null;
}

const WER_ROOT = path.join(
   process.env.ProgramData || 'C:\\ProgramData',
   'Microsoft',
   'Windows',
   'WER'
);

const REPORT_ROOTS = [path.join(WER_ROOT, 'ReportQueue'), path.join(WER_ROOT, 'ReportArchive')];
const MINIDUMP_ROOTS = ['C:\\Windows\\Minidump', 'C:\\Windows\\LiveKernelReports'];

const MAX_EVENTLOG_BSOD = 8000;
const MAX_EVENTLOG_APP = 12000;

const werReportIdCache = new Map<string, ReportIdPair>();

export async function collectCrashEvents(background = false): Promise<CrashEventInput[]> {
   const admin = await isAdministratorSession();

   const [systemEvents, appEvents, osInfo, driverSnapshots] = background
      ? [
           await readSystemCrashEvents(),
           await readApplicationCrashEvents(),
           await readOsInfo(),
           await readDriverSnapshots(),
        ]
      : await Promise.all([
           readSystemCrashEvents(),
           readApplicationCrashEvents(),
           readOsInfo(),
           readDriverSnapshots(),
        ]);

   const allEvents = [...systemEvents, ...appEvents]
      .map((seed) => hydrateFallbacks(seed, osInfo, driverSnapshots, admin))
      .sort((a, b) => a.timestamp - b.timestamp);

   const deduped = dedupeAndMerge(allEvents);
   return enrichBugcheckNamesFromReference(deduped);
}

async function enrichBugcheckNamesFromReference(events: CrashEventInput[]): Promise<CrashEventInput[]> {
   const codeNameCache = new Map<string, string | null>();

   for (const event of events) {
      if (event.crashType !== 'bsod') continue;
      if (event.bugCheckName) continue;

      const code = normalizeBugCheckCode(event.bugCheckCode);
      if (!code) continue;

      if (!codeNameCache.has(code)) {
         const info = await getBugcheckInfo({ code, name: null });
         codeNameCache.set(code, info?.name ? normalizeBugCheckName(info.name) : null);
      }

      const resolved = codeNameCache.get(code);
      if (resolved) {
         event.bugCheckName = resolved;
      }
   }

   return events;
}

async function readSystemCrashEvents(): Promise<CrashEventInput[]> {
   const script = [
      '$events = Get-WinEvent -FilterHashtable @{',
      "   LogName='System';",
      '   Id=1001',
      `} -MaxEvents ${MAX_EVENTLOG_BSOD} -ErrorAction SilentlyContinue |`,
      'Select-Object TimeCreated, ProviderName, Id, LogName, LevelDisplayName, Message, Properties;',
      '$events | ConvertTo-Json -Depth 8',
   ].join(' ');

   const data = await runPowerShellJson<EventLogRecord[] | EventLogRecord>(script);
   const rows = normalizeToArray(data);
   const results: CrashEventInput[] = [];

   for (const row of rows) {
      const timestamp = row.TimeCreated ? parsePwshDate(row.TimeCreated)?.getTime() : null;
      if (!timestamp) continue;

      const message = (row.Message ?? '').trim();
      const provider = row.ProviderName ?? '';
      const id = row.Id ?? 0;

      const isStrongBugcheck =
         provider.toLowerCase() === 'microsoft-windows-wer-systemerrorreporting' && id === 1001;

      const mentionsBlue = /bugcheck|blue screen|bluescreen|livekernelevent/i.test(message);
      if (!isStrongBugcheck && !mentionsBlue) {
         continue;
      }

      const parsedFromEvent = parseBsodEventRecord(row);
      const werContext = resolveWerContext({
         timestamp,
         reportId: parsedFromEvent.reportId,
         preferredEventType: ['BlueScreen', 'LiveKernelEvent'],
      });

      const processFromDump =
         firstNonEmpty(
            werContext ? extractLikelyProcessNameFromDumpFiles(werContext.dumpPaths ?? [], true) : null,
            null
         ) ?? null;

      const mergedDumpPaths = uniqueStrings([
         ...(parsedFromEvent.dumpPaths ?? []),
         ...(werContext?.dumpPaths ?? []),
      ]);

      const relatedLogs = uniqueStrings([
         ...collectRelatedEventHints(row),
         ...(werContext ? buildWerMetadataHints(werContext) : []),
      ]);

      const stackTrace = compactStackTrace([
         parsedFromEvent.stackTrace,
         werContext?.stackTrace,
         readKernelStackHintFromSystemMessage(message),
      ]);

      const bugCheckCode = firstNonEmpty(
         parsedFromEvent.bugCheckCode,
         werContext?.bugCheckCode,
         null
      );

      const seed: NormalizedCrashSeed = {
         timestamp,
         crashType: 'bsod',
         applicationName: null,
         bugCheckCode,
         bugCheckName: null,
         processName: firstNonEmpty(processFromDump, parsedFromEvent.processName, null),
         reportId: firstNonEmpty(parsedFromEvent.reportId, werContext?.reportId, null),
         reportStatus: firstNonEmpty(parsedFromEvent.reportStatus, werContext?.reportStatus, null),
         stackTrace,
         dumpPaths: mergedDumpPaths,
         relatedEventLogs: relatedLogs,
         osVersion: firstNonEmpty(parsedFromEvent.osVersion, werContext?.osVersion, null),
         osBuild: firstNonEmpty(parsedFromEvent.osBuild, werContext?.osBuild, null),
         driverVersion: null,
         rawPayload: message || null,
      };

      results.push(toCrashEventInput(seed));
   }

   return results;
}

async function readApplicationCrashEvents(): Promise<CrashEventInput[]> {
   const script = [
      '$events = Get-WinEvent -FilterHashtable @{',
      "   LogName='Application';",
      `   Id=${[1000, 1001].join(',')}`,
      `} -MaxEvents ${MAX_EVENTLOG_APP} -ErrorAction SilentlyContinue |`,
      'Select-Object TimeCreated, ProviderName, Id, LogName, LevelDisplayName, Message, Properties;',
      '$events | ConvertTo-Json -Depth 8',
   ].join(' ');

   const data = await runPowerShellJson<EventLogRecord[] | EventLogRecord>(script);
   const rows = normalizeToArray(data);
   const results: CrashEventInput[] = [];

   for (const row of rows) {
      const timestamp = row.TimeCreated ? parsePwshDate(row.TimeCreated)?.getTime() : null;
      if (!timestamp) continue;

      const provider = (row.ProviderName ?? '').trim();
      const message = (row.Message ?? '').trim();
      const id = row.Id ?? 0;

      const isAppError1000 = provider.toLowerCase() === 'application error' && id === 1000;
      const isWer1001 = provider.toLowerCase() === 'windows error reporting' && id === 1001;

      if (!isAppError1000 && !isWer1001) {
         continue;
      }

      if (/event\s*name\s*:\s*bluescreen|event\s*name\s*:\s*livekernelevent/i.test(message)) {
         continue;
      }

      const parsed = parseAppEventRecord(row);
      const werContext = resolveWerContext({
         timestamp,
         reportId: parsed.reportId,
         preferredEventType: ['APPCRASH', 'BEX64', 'CLR20r3', 'MoAppCrash'],
      });

      const relatedLogs = uniqueStrings([
         ...collectRelatedEventHints(row),
         ...(werContext ? buildWerMetadataHints(werContext) : []),
      ]);

      const dumpPaths = uniqueStrings([
         ...(parsed.dumpPaths ?? []),
         ...(werContext?.dumpPaths ?? []),
      ]);

      const appName = firstNonEmpty(
         parsed.applicationName,
         werContext?.applicationName,
         parseApplicationName(message),
         'UnknownApp'
      );

      const processName = firstNonEmpty(parsed.processName, werContext?.processName, appName, null);

      const stackTrace = compactStackTrace([
         parsed.stackTrace,
         werContext?.stackTrace,
         readUserStackHintFromMessage(message),
      ]);

      const seed: NormalizedCrashSeed = {
         timestamp,
         crashType: 'app',
         applicationName: appName,
         bugCheckCode: null,
         bugCheckName: null,
         processName,
         reportId: firstNonEmpty(parsed.reportId, werContext?.reportId, null),
         reportStatus: firstNonEmpty(parsed.reportStatus, werContext?.reportStatus, null),
         stackTrace,
         dumpPaths,
         relatedEventLogs: relatedLogs,
         osVersion: firstNonEmpty(parsed.osVersion, werContext?.osVersion, null),
         osBuild: firstNonEmpty(parsed.osBuild, werContext?.osBuild, null),
         driverVersion: null,
         rawPayload: message || null,
      };

      results.push(toCrashEventInput(seed));
   }

   return results;
}

async function readOsInfo(): Promise<{ osVersion: string | null; osBuild: string | null }> {
   const script = [
      'Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue |',
      'Select-Object Version, BuildNumber | ConvertTo-Json -Depth 4',
   ].join(' ');

   const data = await runPowerShellJson<WmiOsRecord[] | WmiOsRecord>(script);
   const row = normalizeToArray(data)[0];
   if (!row) return { osVersion: null, osBuild: null };

   return {
      osVersion: cleanString(row.Version),
      osBuild: cleanString(row.BuildNumber),
   };
}

async function readDriverSnapshots(): Promise<DriverSnapshot[]> {
   const script = [
      'Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue |',
      'Where-Object { $_.DriverVersion -and ($_.DriverName -or $_.DeviceName) } |',
      'Select-Object DeviceName, DriverName, DriverVersion, DriverDate, Manufacturer, DriverProviderName, InfName |',
      'ConvertTo-Json -Depth 6',
   ].join(' ');

   const data = await runPowerShellJson<WmiPnPSignedDriverRecord[] | WmiPnPSignedDriverRecord>(script);
   const rows = normalizeToArray(data);
   const output: DriverSnapshot[] = [];

   for (const row of rows) {
      const version = cleanString(row.DriverVersion);
      if (!version) continue;

      const device = cleanString(row.DeviceName) ?? cleanString(row.DriverProviderName) ?? 'device';
      const vendor = cleanString(row.Manufacturer) ?? cleanString(row.DriverProviderName) ?? 'vendor';
      const driverName = normalizeImageName(cleanString(row.DriverName));
      const infName = cleanString(row.InfName);
      const date = row.DriverDate ? parsePwshDate(row.DriverDate)?.getTime() : null;

      output.push({
         timestamp: date ?? 0,
         value: `${vendor} ${device} ${version}`,
         driverName,
         driverVersion: version,
         deviceName: cleanString(row.DeviceName),
         providerName: cleanString(row.DriverProviderName),
         manufacturer: cleanString(row.Manufacturer),
         infName,
      });
   }

   output.sort((a, b) => a.timestamp - b.timestamp);
   return output;
}

function hydrateFallbacks(
   event: CrashEventInput,
   osInfo: { osVersion: string | null; osBuild: string | null },
   driverSnapshots: DriverSnapshot[],
   admin: boolean
): CrashEventInput {
   const clone: CrashEventInput = {
      ...event,
      dumpPaths: event.dumpPaths ? [...event.dumpPaths] : [],
      relatedEventLogs: event.relatedEventLogs ? [...event.relatedEventLogs] : [],
   };

   if (!clone.osVersion) clone.osVersion = osInfo.osVersion;
   if (!clone.osBuild) clone.osBuild = osInfo.osBuild;

   clone.driverVersion = resolveDriverVersionForEvent(clone, driverSnapshots);

   const existingDumpPaths = clone.dumpPaths ?? [];
   const hasRealDump = existingDumpPaths.some((item) => /\.dmp$/i.test(item));
   const extraDumpPaths =
      clone.crashType === 'bsod' && !hasRealDump ? findDumpFilesNear(clone.timestamp, true) : [];
   clone.dumpPaths = uniqueStrings([...existingDumpPaths, ...extraDumpPaths]);

   if (!clone.processName && clone.crashType === 'bsod') {
      clone.processName = firstNonEmpty(
         extractLikelyProcessNameFromDumpFiles(clone.dumpPaths ?? [], true),
         clone.processName,
         null
      );
   }

   if (!clone.stackTrace) {
      clone.stackTrace = extractStackHintsFromFiles(clone.dumpPaths ?? []);
   }

   if (admin) {
      clone.relatedEventLogs = uniqueStrings([
         ...(clone.relatedEventLogs ?? []),
         'privilege=administrator',
      ]);
   }

   clone.hashId = hashCrashEvent({
      timestamp: clone.timestamp,
      crashType: clone.crashType,
      applicationName: clone.applicationName,
      bugCheckCode: clone.bugCheckCode,
      bugCheckName: clone.bugCheckName,
      processName: clone.processName,
      reportId: clone.reportId,
      reportStatus: clone.reportStatus,
      stackTrace: clone.stackTrace,
      dumpPaths: clone.dumpPaths,
      relatedEventLogs: clone.relatedEventLogs,
      osVersion: clone.osVersion,
      osBuild: clone.osBuild,
      driverVersion: clone.driverVersion,
      rawPayload: clone.rawPayload,
   });

   return clone;
}

function pickDriverSnapshotForTimestamp(snapshots: DriverSnapshot[], timestamp: number): string | null {
   if (snapshots.length === 0) return null;

   let best: DriverSnapshot | null = null;
   for (const item of snapshots) {
      if (item.timestamp <= timestamp) {
         best = item;
      }
   }

   if (best) return best.value;
   return snapshots[snapshots.length - 1]?.value ?? null;
}

function resolveDriverVersionForEvent(
   event: CrashEventInput,
   snapshots: DriverSnapshot[]
): string | null {
   if (snapshots.length === 0) return event.driverVersion ?? null;

   const processName = normalizeImageName(event.processName);
   if (event.crashType === 'bsod' && processName && /\.sys$/i.test(processName)) {
      const matchedByDriverName = snapshots.filter((snapshot) => {
         return (
            snapshot.driverName != null &&
            snapshot.driverName.toLowerCase() === processName.toLowerCase()
         );
      });

      if (matchedByDriverName.length > 0) {
         const picked = pickNearestSnapshotByTimestamp(matchedByDriverName, event.timestamp);
         return formatDriverSnapshot(picked);
      }
   }

   const existing = cleanString(event.driverVersion);
   if (existing) return existing;
   return pickDriverSnapshotForTimestamp(snapshots, event.timestamp);
}

function pickNearestSnapshotByTimestamp(
   snapshots: DriverSnapshot[],
   timestamp: number
): DriverSnapshot {
   let best = snapshots[0];
   let bestDistance = Math.abs(best.timestamp - timestamp);

   for (let i = 1; i < snapshots.length; i++) {
      const current = snapshots[i];
      const distance = Math.abs(current.timestamp - timestamp);
      if (distance < bestDistance) {
         best = current;
         bestDistance = distance;
      }
   }

   return best;
}

function formatDriverSnapshot(snapshot: DriverSnapshot): string {
   const provider = snapshot.providerName ?? snapshot.manufacturer ?? 'UnknownProvider';
   const driver = snapshot.driverName ?? snapshot.deviceName ?? 'UnknownDriver';
   const version = snapshot.driverVersion ?? 'UnknownVersion';
   const inf = snapshot.infName ? ` (${snapshot.infName})` : '';
   return `${provider} ${driver} ${version}${inf}`;
}

function parseBsodEventRecord(record: EventLogRecord): {
   bugCheckCode: string | null;
   bugCheckName: string | null;
   processName: string | null;
   reportId: string | null;
   reportStatus: string | null;
   stackTrace: string | null;
   dumpPaths: string[];
   osVersion: string | null;
   osBuild: string | null;
} {
   const message = record.Message ?? '';
   const props = (record.Properties ?? []).map((item) => String(item.Value ?? '').trim());

   const bugCodeFromProps = props.find((x) => /^0x[0-9a-f]+/i.test(x));
   const bugCodeFromText = firstMatch(message, [/bugcheck\s+was\s*:\s*(0x[0-9a-f]+)/i, /P1:\s*([0-9a-f]+)\b/i]);

   const reportId = firstNonEmpty(
      props.find((x) => looksLikeGuid(x)),
      firstMatch(message, [/report\s+id\s*:\s*([0-9a-f-]{36})/i]),
      null
   );

   const reportStatus = firstNonEmpty(
      firstMatch(message, [/report\s+status\s*:\s*([0-9]+)/i]),
      null
   );

   const dumpPaths = uniqueStrings([
      ...extractWindowsPathsFromText(message),
      ...extractWindowsPathsFromProperties(props),
   ]).filter(isLikelyDumpOrWerPath);

   const osSig = firstNonEmpty(
      firstMatch(message, [/P6:\s*([0-9_]+)/i]),
      firstMatch(message, [/os\s+version\s*[:=]\s*([0-9_.]+)/i]),
      null
   );

   const osVersion = normalizeWerVersion(osSig);
   const osBuild = normalizeWerBuild(osSig);

   const bugCheckCode = normalizeBugCheckCode(bugCodeFromProps ?? bugCodeFromText);
   return {
      bugCheckCode: bugCheckCode || null,
      bugCheckName: null,
      processName: null,
      reportId,
      reportStatus,
      stackTrace: readKernelStackHintFromSystemMessage(message),
      dumpPaths,
      osVersion,
      osBuild,
   };
}

function parseAppEventRecord(record: EventLogRecord): {
   applicationName: string | null;
   processName: string | null;
   reportId: string | null;
   reportStatus: string | null;
   stackTrace: string | null;
   dumpPaths: string[];
   osVersion: string | null;
   osBuild: string | null;
} {
   const message = record.Message ?? '';
   const props = (record.Properties ?? []).map((item) => String(item.Value ?? '').trim());

   const appName = firstNonEmpty(
      props.find((x) => /\.exe$/i.test(x)),
      parseApplicationName(message),
      null
   );

   const reportId = firstNonEmpty(
      props.find((x) => looksLikeGuid(x)),
      firstMatch(message, [/report\s+id\s*:\s*([0-9a-f-]{36})/i]),
      null
   );

   const reportStatus = firstNonEmpty(
      firstMatch(message, [/report\s+status\s*:\s*([0-9]+)/i]),
      null
   );

   const dumpPaths = uniqueStrings([
      ...extractWindowsPathsFromText(message),
      ...extractWindowsPathsFromProperties(props),
   ]).filter(isLikelyDumpOrWerPath);

   return {
      applicationName: appName,
      processName: appName,
      reportId,
      reportStatus,
      stackTrace: readUserStackHintFromMessage(message),
      dumpPaths,
      osVersion: null,
      osBuild: null,
   };
}

function resolveWerContext(input: {
   timestamp: number;
   reportId: string | null;
   preferredEventType: string[];
}): WerReportMetadata | null {
   const reportDir = findWerReportDirectoryNear(input.timestamp, input.reportId, input.preferredEventType);
   if (!reportDir) return null;

   const parsed = parseWerReportDirectory(reportDir);
   if (!parsed) return null;

   if (input.reportId && parsed.reportId && parsed.reportId.toLowerCase() !== input.reportId.toLowerCase()) {
      return null;
   }

   return parsed;
}

function findWerReportDirectoryNear(
   timestamp: number,
   reportId: string | null,
   preferredEventType: string[]
): string | null {
   const candidates: Array<{ path: string; score: number }> = [];

   for (const root of REPORT_ROOTS) {
      if (!fs.existsSync(root)) continue;
      let entries: fs.Dirent[] = [];
      try {
         entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
         continue;
      }

      for (const entry of entries) {
         if (!entry.isDirectory()) continue;
         const fullPath = path.join(root, entry.name);
         let stat: fs.Stats;
         try {
            stat = fs.statSync(fullPath);
         } catch {
            continue;
         }

         const ageScore = 1 - Math.min(1, Math.abs(stat.mtimeMs - timestamp) / (48 * 60 * 60 * 1000));
         let score = ageScore;

         if (reportId && entry.name.toLowerCase().includes(reportId.toLowerCase())) {
            score += 3;
         } else if (reportId) {
            const pair = getWerReportIdPair(fullPath);
            const rid = reportId.toLowerCase();
            const matchByReportFile =
               pair.integratorReportId?.toLowerCase() === rid ||
               pair.reportIdentifier?.toLowerCase() === rid;

            if (matchByReportFile) {
               score += 4;
            } else {
               score -= 1.5;
            }
         }

         const lower = entry.name.toLowerCase();

         const isKernelPref = preferredEventType.some((x) => /blue|livekernel/i.test(x));
         const isAppPref = preferredEventType.some((x) => /appcrash|bex|clr20|moapp/i.test(x));

         if (isKernelPref) {
            if (/kernel_|bluescreen|livekernel/i.test(lower)) score += 1.5;
            if (/appcrash|moappcrash|bex|clr20/i.test(lower)) score -= 1;
         }

         if (isAppPref) {
            if (/appcrash|moappcrash|bex|clr20/i.test(lower)) score += 1.5;
            if (/kernel_|bluescreen|livekernel/i.test(lower)) score -= 1;
         }

         for (const hint of preferredEventType) {
            if (lower.includes(hint.toLowerCase())) {
               score += 1;
               break;
            }
         }

         if (score > 0.1) {
            candidates.push({ path: fullPath, score });
         }
      }
   }

   if (candidates.length === 0) return null;
   candidates.sort((a, b) => b.score - a.score);
   return candidates[0].path;
}

function parseWerReportDirectory(reportDir: string): WerReportMetadata | null {
   const reportWerPath = path.join(reportDir, 'Report.wer');
   if (!fs.existsSync(reportWerPath)) {
      return null;
   }

   const reportMap = parseWerKeyValueFile(reportWerPath);
   const metadataXmlPath = findFirstFileBySuffix(reportDir, '.werinternalmetadata.xml');
   const metadata = metadataXmlPath ? parseWerInternalMetadata(metadataXmlPath) : null;

   const fromWer = parseWerMap(reportMap);
   const dumpPaths = uniqueStrings([
      ...collectDumpPathsFromWerMap(reportMap),
      ...listDumpFilesWithinFolder(reportDir),
      ...(metadata?.dumpPaths ?? []),
   ]);

   return {
      eventType: firstNonEmpty(fromWer.eventType, metadata?.eventType, null),
      reportId: firstNonEmpty(fromWer.reportId, metadata?.reportId, null),
      reportStatus: firstNonEmpty(fromWer.reportStatus, metadata?.reportStatus, null),
      osVersion: firstNonEmpty(fromWer.osVersion, metadata?.osVersion, null),
      osBuild: firstNonEmpty(fromWer.osBuild, metadata?.osBuild, null),
      product: firstNonEmpty(fromWer.product, metadata?.product, null),
      bugCheckCode: firstNonEmpty(fromWer.bugCheckCode, metadata?.bugCheckCode, null),
      parameter1: firstNonEmpty(fromWer.parameter1, metadata?.parameter1, null),
      parameter2: firstNonEmpty(fromWer.parameter2, metadata?.parameter2, null),
      parameter3: firstNonEmpty(fromWer.parameter3, metadata?.parameter3, null),
      parameter4: firstNonEmpty(fromWer.parameter4, metadata?.parameter4, null),
      dumpPaths,
      processName: firstNonEmpty(fromWer.processName, metadata?.processName, null),
      applicationName: firstNonEmpty(fromWer.applicationName, metadata?.applicationName, null),
      moduleName: firstNonEmpty(fromWer.moduleName, metadata?.moduleName, null),
      exceptionCode: firstNonEmpty(fromWer.exceptionCode, metadata?.exceptionCode, null),
      stackTrace: compactStackTrace([fromWer.stackTrace, metadata?.stackTrace]),
   };
}

function getWerReportIdPair(reportDir: string): ReportIdPair {
   const cached = werReportIdCache.get(reportDir);
   if (cached) return cached;

   const reportWerPath = path.join(reportDir, 'Report.wer');
   if (!fs.existsSync(reportWerPath)) {
      const empty: ReportIdPair = { integratorReportId: null, reportIdentifier: null };
      werReportIdCache.set(reportDir, empty);
      return empty;
   }

   const map = parseWerKeyValueFile(reportWerPath);
   const pair: ReportIdPair = {
      integratorReportId: cleanString(map.get('IntegratorReportIdentifier')),
      reportIdentifier: cleanString(map.get('ReportIdentifier')),
   };
   werReportIdCache.set(reportDir, pair);
   return pair;
}

function parseWerKeyValueFile(filePath: string): Map<string, string> {
   const output = new Map<string, string>();
   let text: string;
   try {
      const raw = fs.readFileSync(filePath);
      text = decodeLikelyUnicode(raw);
   } catch {
      return output;
   }

   for (const lineRaw of text.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line) continue;
      const idx = line.indexOf('=');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) continue;
      output.set(key, value);
   }

   return output;
}

function parseWerMap(map: Map<string, string>): WerReportMetadata {
   const eventType = map.get('EventType') ?? map.get('FriendlyEventName') ?? null;
   const eventTypeLower = (eventType ?? '').toLowerCase();
   const isKernelStyleEvent =
      /bluescreen|livekernelevent|shutdown unexpectedly|bugcheck/.test(eventTypeLower);
   const reportId = firstNonEmpty(map.get('IntegratorReportIdentifier'), map.get('ReportIdentifier'), null);
   const reportStatus = map.get('ReportStatus') ?? null;

   const osVersion = firstNonEmpty(
      normalizeWerVersion(map.get('Sig[5].Value') ?? null),
      normalizeWerVersion(map.get('DynamicSig[1].Value') ?? null),
      normalizeWerVersion(map.get('OsInfo[29].Value') ?? null),
      null
   );

   const osBuild = firstNonEmpty(
      map.get('OsInfo[2].Value') ?? null,
      normalizeWerBuild(map.get('Sig[5].Value') ?? null),
      normalizeWerBuild(map.get('DynamicSig[1].Value') ?? null),
      null
   );

   const bugCheckRaw = isKernelStyleEvent
      ? firstNonEmpty(
           map.get('Sig[0].Value') ?? null,
           map.get('Ns[0].Value') ?? null,
           map.get('stopcode') ?? null,
           null
        )
      : null;

   const bugCheckCode = bugCheckRaw ? normalizeBugCheckCode(bugCheckRaw) : null;

   const applicationName = isKernelStyleEvent
      ? null
      : firstNonEmpty(
           normalizeExeName(map.get('Sig[0].Value') ?? null),
           normalizeExeName(map.get('P1') ?? null),
           normalizeExeName(map.get('AppName') ?? null),
           null
        );

   const processName = isKernelStyleEvent
      ? null
      : firstNonEmpty(
           normalizeExeName(map.get('NsAppName') ?? null),
           applicationName,
           null
        );

   return {
      eventType,
      reportId,
      reportStatus,
      osVersion,
      osBuild,
      product: map.get('Sig[7].Value') ?? null,
      bugCheckCode,
      parameter1: firstNonEmpty(map.get('Sig[1].Value'), map.get('Ns[1].Value'), null),
      parameter2: firstNonEmpty(map.get('Sig[2].Value'), map.get('Ns[2].Value'), null),
      parameter3: firstNonEmpty(map.get('Sig[3].Value'), map.get('Ns[3].Value'), null),
      parameter4: firstNonEmpty(map.get('Sig[4].Value'), map.get('Ns[4].Value'), null),
      applicationName,
      processName,
      moduleName: normalizeDllName(firstNonEmpty(map.get('Sig[3].Value'), map.get('Sig[8].Value'), null)),
      exceptionCode: firstNonEmpty(map.get('Sig[7].Value'), map.get('Sig[8].Value'), null),
      stackTrace: null,
      dumpPaths: collectDumpPathsFromWerMap(map),
   };
}

function parseWerInternalMetadata(filePath: string): WerReportMetadata | null {
   let xmlText: string;
   try {
      const raw = fs.readFileSync(filePath);
      xmlText = decodeLikelyUnicode(raw);
   } catch {
      return null;
   }

   const xml = xmlText;
   const eventType = firstNonEmpty(
      extractXmlTag(xml, 'EventType'),
      extractXmlTag(xml, 'FriendlyEventName'),
      null
   );

   const reportId = firstNonEmpty(extractXmlTag(xml, 'Guid'), null);

   const osVersion = firstNonEmpty(
      normalizeWerVersion(extractXmlTag(xml, 'WindowsNTVersion')),
      normalizeWerVersion(extractXmlTag(xml, 'BuildString')),
      null
   );

   const osBuild = firstNonEmpty(
      extractXmlTag(xml, 'Build'),
      extractXmlTag(xml, 'Revision'),
      null
   );

   const p0 = extractXmlTag(xml, 'Parameter0');
   const bugCheckCode = p0 ? normalizeBugCheckCode(p0) : null;

   const app = firstNonEmpty(
      normalizeExeName(extractXmlTag(xml, 'Parameter0')),
      normalizeExeName(extractXmlTag(xml, 'ApplicationName')),
      null
   );

   return {
      eventType,
      reportId,
      reportStatus: null,
      osVersion,
      osBuild,
      product: extractXmlTag(xml, 'Product'),
      bugCheckCode,
      parameter1: extractXmlTag(xml, 'Parameter1'),
      parameter2: extractXmlTag(xml, 'Parameter2'),
      parameter3: extractXmlTag(xml, 'Parameter3'),
      parameter4: extractXmlTag(xml, 'Parameter4'),
      processName: app,
      applicationName: app,
      moduleName: normalizeDllName(extractXmlTag(xml, 'ModuleName')),
      exceptionCode: extractXmlTag(xml, 'ExceptionCode'),
      stackTrace: extractXmlTag(xml, 'StackHash') ?? null,
      dumpPaths: uniqueStrings(extractXmlDumpPaths(xml)),
   };
}

function collectDumpPathsFromWerMap(map: Map<string, string>): string[] {
   const output: string[] = [];

   for (const [key, value] of map.entries()) {
      if (/^File\[\d+\]\.Original\.Path$/i.test(key) && value) {
         output.push(cleanWerPath(value));
      }
      if (/^File\[\d+\]\.Path$/i.test(key) && value && /\\|\//.test(value)) {
         output.push(cleanWerPath(value));
      }
   }

   const blocks = [
      map.get('Attached files'),
      map.get('These files may be available here'),
      map.get('FilePath'),
   ];

   for (const block of blocks) {
      if (!block) continue;
      output.push(...extractWindowsPathsFromText(block));
   }

   return uniqueStrings(output).filter(isLikelyDumpOrWerPath);
}

function extractXmlDumpPaths(xml: string): string[] {
   const output: string[] = [];
   const filePathTags = ['Original.Path', 'Path', 'CabName'];

   for (const tag of filePathTags) {
      const regex = new RegExp(`<${escapeRegExp(tag)}>([^<]+)</${escapeRegExp(tag)}>`, 'gi');
      let match: RegExpExecArray | null = null;
      while ((match = regex.exec(xml)) !== null) {
         const cleaned = cleanWerPath(match[1]);
         if (cleaned) output.push(cleaned);
      }
   }

   output.push(...extractWindowsPathsFromText(xml));
   return uniqueStrings(output).filter(isLikelyDumpOrWerPath);
}

function buildWerMetadataHints(metadata: WerReportMetadata): string[] {
   const hints: string[] = [];

   if (metadata.eventType) hints.push(`wer.eventType=${metadata.eventType}`);
   if (metadata.reportId) hints.push(`wer.reportId=${metadata.reportId}`);
   if (metadata.reportStatus) hints.push(`wer.reportStatus=${metadata.reportStatus}`);
   if (metadata.bugCheckCode) hints.push(`wer.bugcheck=${metadata.bugCheckCode}`);
   if (metadata.parameter1) hints.push(`wer.p1=${metadata.parameter1}`);
   if (metadata.parameter2) hints.push(`wer.p2=${metadata.parameter2}`);
   if (metadata.parameter3) hints.push(`wer.p3=${metadata.parameter3}`);
   if (metadata.parameter4) hints.push(`wer.p4=${metadata.parameter4}`);
   if (metadata.applicationName) hints.push(`wer.app=${metadata.applicationName}`);
   if (metadata.moduleName) hints.push(`wer.module=${metadata.moduleName}`);
   if (metadata.exceptionCode) hints.push(`wer.exception=${metadata.exceptionCode}`);

   return hints;
}

function readKernelStackHintFromSystemMessage(message: string): string | null {
   const lines = message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

   const stackLines = lines.filter((line) =>
      /[a-z0-9_]+\+0x[0-9a-f]+/i.test(line) || /STACK_TEXT|STACK_COMMAND/i.test(line)
   );

   if (stackLines.length === 0) return null;
   return stackLines.slice(0, 20).join('\n');
}

function readUserStackHintFromMessage(message: string): string | null {
   const lines = message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

   const interesting = lines.filter((line) =>
      /exception code|fault offset|faulting module|stack hash/i.test(line)
   );

   if (interesting.length === 0) return null;
   return interesting.slice(0, 20).join('\n');
}

function findDumpFilesNear(timestamp: number, preferKernel: boolean): string[] {
   const output: string[] = [];

   for (const root of MINIDUMP_ROOTS) {
      const entries = readDirectoryRecursively(root, 2);
      for (const fullPath of entries) {
         if (!/\.dmp$/i.test(fullPath)) continue;

         let stat: fs.Stats;
         try {
            stat = fs.statSync(fullPath);
         } catch {
            continue;
         }

         const windowMs = preferKernel ? 72 * 60 * 60 * 1000 : 14 * 24 * 60 * 60 * 1000;
         if (Math.abs(stat.mtimeMs - timestamp) <= windowMs) {
            output.push(fullPath);
         }
      }
   }

   return uniqueStrings(output);
}

function extractLikelyProcessNameFromDumpFiles(
   dumpPaths: string[],
   preferKernelModuleOnly: boolean
): string | null {
   const candidates: string[] = [];

   for (const dumpPath of dumpPaths) {
      if (!dumpPath || !fs.existsSync(dumpPath)) continue;
      if (!/\.dmp$/i.test(dumpPath)) continue;

      const fromHeader = parseLikelyFaultingImageFromBinaryFile(
         dumpPath,
         2 * 1024 * 1024,
         preferKernelModuleOnly
      );
      if (fromHeader) candidates.push(fromHeader);

      const fromNearbyWer = parseProcessNameFromAdjacentWer(dumpPath, preferKernelModuleOnly);
      if (fromNearbyWer) candidates.push(fromNearbyWer);
   }

   return pickMostLikelyImage(candidates, preferKernelModuleOnly);
}

function extractStackHintsFromFiles(paths: string[]): string | null {
   const hints: string[] = [];

   for (const p of paths) {
      if (!fs.existsSync(p)) continue;
      if (/\.wer$/i.test(p)) {
         const map = parseWerKeyValueFile(p);
         const stack = firstNonEmpty(map.get('StackHash') ?? null, map.get('Ns[4].Value') ?? null, null);
         if (stack) hints.push(`wer.stack=${stack}`);
      }
      if (/\.xml$/i.test(p)) {
         try {
            const raw = fs.readFileSync(p);
            const text = decodeLikelyUnicode(raw);
            const stackHash = extractXmlTag(text, 'StackHash');
            if (stackHash) hints.push(`xml.stack=${stackHash}`);
         } catch {
            continue;
         }
      }
   }

   if (hints.length === 0) return null;
   return uniqueStrings(hints).slice(0, 20).join('\n');
}

function parseProcessNameFromAdjacentWer(
   dumpPath: string,
   preferKernelModuleOnly: boolean
): string | null {
   const dir = path.dirname(dumpPath);

   const adjacentReport = path.join(dir, 'Report.wer');
   if (fs.existsSync(adjacentReport)) {
      const map = parseWerKeyValueFile(adjacentReport);
      const app = firstNonEmpty(
         normalizeImageName(map.get('Sig[0].Value') ?? null),
         normalizeImageName(map.get('NsAppName') ?? null),
         normalizeImageName(map.get('AppName') ?? null),
         null
      );
      if (preferKernelModuleOnly && app && !/\.sys$/i.test(app)) {
         return null;
      }
      if (app) return app;
   }

   const nearestWer = findNearestWerReportForDump(dumpPath);
   if (nearestWer) {
      const map = parseWerKeyValueFile(nearestWer);
      return firstNonEmpty(
         normalizeImageName(map.get('Sig[0].Value') ?? null),
         normalizeImageName(map.get('NsAppName') ?? null),
         normalizeImageName(map.get('AppName') ?? null),
         null
      );
   }

   return null;
}

function findNearestWerReportForDump(dumpPath: string): string | null {
   let best: { path: string; score: number } | null = null;

   for (const root of REPORT_ROOTS) {
      if (!fs.existsSync(root)) continue;

      let entries: fs.Dirent[] = [];
      try {
         entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
         continue;
      }

      for (const entry of entries) {
         if (!entry.isDirectory()) continue;
         const fullDir = path.join(root, entry.name);
         const report = path.join(fullDir, 'Report.wer');
         if (!fs.existsSync(report)) continue;

         const score = scoreWerFolderAgainstDump(fullDir, dumpPath);
         if (score <= 0) continue;

         if (!best || score > best.score) {
            best = { path: report, score };
         }
      }
   }

   return best?.path ?? null;
}

function scoreWerFolderAgainstDump(folder: string, dumpPath: string): number {
   const dumpBase = path.basename(dumpPath).toLowerCase();
   let score = 0;

   try {
      const files = fs.readdirSync(folder);
      for (const file of files) {
         const lower = file.toLowerCase();
         if (lower === dumpBase) score += 5;
         if (lower.endsWith('.dmp') && lower.slice(-12) === dumpBase.slice(-12)) score += 2;
      }

      const statFolder = fs.statSync(folder);
      const statDump = fs.statSync(dumpPath);
      const delta = Math.abs(statFolder.mtimeMs - statDump.mtimeMs);
      score += 1 - Math.min(1, delta / (48 * 60 * 60 * 1000));
   } catch {
      return 0;
   }

   return score;
}

function parseLikelyFaultingImageFromBinaryFile(
   filePath: string,
   maxBytes: number,
   preferKernelModuleOnly: boolean
): string | null {
   let buffer: Buffer;
   try {
      const fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      const size = Math.min(stat.size, maxBytes);
      buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, 0);
      fs.closeSync(fd);
   } catch {
      return null;
   }

   const textAscii = buffer.toString('latin1');
   const textUtf16 = buffer.toString('utf16le');

   const fromAscii = pickMostLikelyImage(extractImageTokens(textAscii), preferKernelModuleOnly);
   const fromUtf16 = pickMostLikelyImage(extractImageTokens(textUtf16), preferKernelModuleOnly);

   return firstNonEmpty(fromAscii, fromUtf16, null);
}

function extractImageTokens(text: string): string[] {
   const output: string[] = [];
   const regex = /([A-Za-z0-9_ .-]{1,120}\.(?:exe|sys))/g;
   let match: RegExpExecArray | null = null;
   while ((match = regex.exec(text)) !== null) {
      const token = normalizeImageName(match[1]);
      if (token) output.push(token);
   }
   return uniqueStrings(output);
}

function pickMostLikelyImage(
   items: Array<string | null | undefined>,
   preferKernelModuleOnly = false
): string | null {
   const counts = new Map<string, number>();

   for (const raw of items) {
      const token = normalizeImageName(raw ?? null);
      if (!token) continue;

      const lower = token.toLowerCase();
      if (isNoisyImage(lower)) continue;
      if (preferKernelModuleOnly && !lower.endsWith('.sys')) continue;

      counts.set(token, (counts.get(token) ?? 0) + 1);
   }

   const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
   const sysFirst = sorted.find(([name]) => name.toLowerCase().endsWith('.sys'));
   if (preferKernelModuleOnly) {
      return sysFirst?.[0] ?? null;
   }

   return (sysFirst ?? sorted[0])?.[0] ?? null;
}

function isNoisyImage(lowerImage: string): boolean {
   const noise = new Set([
      'werfault.exe',
      'dwm.exe',
      'csrss.exe',
      'searchhost.exe',
      'shellexperiencehost.exe',
      'startmenuexperiencehost.exe',
      'runtimebroker.exe',
      'lockapp.exe',
      'applicationframehost.exe',
      'explorer.exe',
      'taskmgr.exe',
      'ntoskrnl.exe',
      'ntoskrnl.sys',
      'hal.dll',
      'hal.sys',
   ]);

   return noise.has(lowerImage);
}

function toCrashEventInput(seed: NormalizedCrashSeed): CrashEventInput {
   const normalized: Omit<CrashEventInput, 'hashId'> = {
      timestamp: seed.timestamp,
      crashType: seed.crashType,
      applicationName: seed.applicationName,
      bugCheckCode: seed.bugCheckCode,
      bugCheckName: seed.bugCheckName,
      processName: seed.processName,
      reportId: seed.reportId,
      reportStatus: seed.reportStatus,
      stackTrace: seed.stackTrace,
      dumpPaths: uniqueStrings(seed.dumpPaths),
      relatedEventLogs: uniqueStrings(seed.relatedEventLogs),
      osVersion: seed.osVersion,
      osBuild: seed.osBuild,
      driverVersion: seed.driverVersion,
      rawPayload: seed.rawPayload,
   };

   return {
      hashId: hashCrashEvent(normalized),
      ...normalized,
   };
}

function dedupeAndMerge(events: CrashEventInput[]): CrashEventInput[] {
   const hashMap = new Map<string, CrashEventInput>();

   for (const event of events) {
      const existing = hashMap.get(event.hashId);
      if (!existing) {
         hashMap.set(event.hashId, event);
         continue;
      }

      hashMap.set(event.hashId, mergeCrashEvents(existing, event));
   }

   const reportMap = new Map<string, CrashEventInput>();
   for (const event of hashMap.values()) {
      const reportId = cleanString(event.reportId);
      if (!reportId) {
         const transientKey = `${event.hashId}:${event.timestamp}`;
         reportMap.set(transientKey, event);
         continue;
      }

      const key = `${event.crashType}:${reportId.toLowerCase()}`;
      const existing = reportMap.get(key);
      if (!existing) {
         reportMap.set(key, event);
         continue;
      }

      reportMap.set(key, mergeCrashEvents(existing, event));
   }

   return [...reportMap.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function mergeCrashEvents(a: CrashEventInput, b: CrashEventInput): CrashEventInput {
   const mergedTimestamp = Math.min(a.timestamp, b.timestamp);

   const merged: CrashEventInput = {
      hashId: a.hashId,
      timestamp: mergedTimestamp,
      crashType: a.crashType,
      applicationName: firstNonEmpty(a.applicationName, b.applicationName, null),
      bugCheckCode: firstNonEmpty(a.bugCheckCode, b.bugCheckCode, null),
      bugCheckName: firstNonEmpty(a.bugCheckName, b.bugCheckName, null),
      processName: firstNonEmpty(a.processName, b.processName, null),
      reportId: firstNonEmpty(a.reportId, b.reportId, null),
      reportStatus: firstNonEmpty(a.reportStatus, b.reportStatus, null),
      stackTrace: compactStackTrace([a.stackTrace, b.stackTrace]),
      dumpPaths: uniqueStrings([...(a.dumpPaths ?? []), ...(b.dumpPaths ?? [])]),
      relatedEventLogs: uniqueStrings([...(a.relatedEventLogs ?? []), ...(b.relatedEventLogs ?? [])]),
      osVersion: firstNonEmpty(a.osVersion, b.osVersion, null),
      osBuild: firstNonEmpty(a.osBuild, b.osBuild, null),
      driverVersion: firstNonEmpty(a.driverVersion, b.driverVersion, null),
      rawPayload: compactRawPayload([a.rawPayload, b.rawPayload]),
   };

   return {
      ...merged,
      hashId: hashCrashEvent({
         timestamp: merged.timestamp,
         crashType: merged.crashType,
         applicationName: merged.applicationName,
         bugCheckCode: merged.bugCheckCode,
         bugCheckName: merged.bugCheckName,
         processName: merged.processName,
         reportId: merged.reportId,
         reportStatus: merged.reportStatus,
         stackTrace: merged.stackTrace,
         dumpPaths: merged.dumpPaths,
         relatedEventLogs: merged.relatedEventLogs,
         osVersion: merged.osVersion,
         osBuild: merged.osBuild,
         driverVersion: merged.driverVersion,
         rawPayload: merged.rawPayload,
      }),
   };
}

function compactRawPayload(payloads: Array<string | null | undefined>): string | null {
   const chunks = payloads
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .slice(0, 2);
   if (chunks.length === 0) return null;
   return chunks.join('\n\n---\n\n').slice(0, 12_000);
}

function compactStackTrace(items: Array<string | null | undefined>): string | null {
   const lines = uniqueStrings(
      items
         .flatMap((item) => (item ?? '').split(/\r?\n/))
         .map((line) => line.trim())
         .filter(Boolean)
   );

   if (lines.length === 0) return null;
   return lines.slice(0, 40).join('\n');
}

function parseApplicationName(message: string): string {
   const patterns = [
      /faulting\s+application\s+name\s*[:=]\s*([^,\n]+)/i,
      /application\s+name\s*[:=]\s*([^,\n]+)/i,
      /P1:\s*([A-Za-z0-9_.-]+\.exe)/i,
      /\b([A-Za-z0-9_.-]+\.exe)\b/,
   ];

   for (const pattern of patterns) {
      const match = message.match(pattern);
      const token = normalizeExeName(match?.[1] ?? null);
      if (token) return token;
   }

   return 'UnknownApp';
}

function collectRelatedEventHints(record: EventLogRecord): string[] {
   const output: string[] = [];

   if (record.LogName) output.push(`log=${record.LogName}`);
   if (record.ProviderName) output.push(`provider=${record.ProviderName}`);
   if (record.Id != null) output.push(`eventId=${record.Id}`);
   if (record.LevelDisplayName) output.push(`level=${record.LevelDisplayName}`);

   if (record.Message) {
      output.push(record.Message.slice(0, 2000));
   }

   return output;
}

function readDirectoryRecursively(root: string, depth: number): string[] {
   if (depth < 0) return [];
   if (!fs.existsSync(root)) return [];

   const output: string[] = [];
   let entries: fs.Dirent[] = [];
   try {
      entries = fs.readdirSync(root, { withFileTypes: true });
   } catch {
      return output;
   }

   for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isFile()) {
         output.push(fullPath);
      } else if (entry.isDirectory()) {
         output.push(...readDirectoryRecursively(fullPath, depth - 1));
      }
   }

   return output;
}

function listDumpFilesWithinFolder(folder: string): string[] {
   const output: string[] = [];
   try {
      const entries = fs.readdirSync(folder);
      for (const name of entries) {
         if (!/\.dmp$/i.test(name)) continue;
         output.push(path.join(folder, name));
      }
   } catch {
      return output;
   }

   return output;
}

function findFirstFileBySuffix(folder: string, suffix: string): string | null {
   let entries: string[] = [];
   try {
      entries = fs.readdirSync(folder);
   } catch {
      return null;
   }

   const lowerSuffix = suffix.toLowerCase();
   for (const entry of entries) {
      if (entry.toLowerCase().endsWith(lowerSuffix)) {
         return path.join(folder, entry);
      }
   }

   return null;
}

function decodeLikelyUnicode(buffer: Buffer): string {
   if (buffer.length >= 2) {
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
         return buffer.toString('utf16le');
      }
      if (buffer[0] === 0xfe && buffer[1] === 0xff) {
         const swapped = Buffer.alloc(buffer.length - (buffer.length % 2));
         for (let i = 0; i < swapped.length; i += 2) {
            swapped[i] = buffer[i + 1];
            swapped[i + 1] = buffer[i];
         }
         return swapped.toString('utf16le');
      }
   }

   const sample = buffer.subarray(0, Math.min(256, buffer.length));
   let zeroCount = 0;
   for (const b of sample) {
      if (b === 0) zeroCount += 1;
   }

   if (sample.length > 0 && zeroCount / sample.length > 0.2) {
      return buffer.toString('utf16le');
   }

   return buffer.toString('utf8');
}

function extractXmlTag(xml: string, tagName: string): string | null {
   const regex = new RegExp(`<${escapeRegExp(tagName)}>([\\s\\S]*?)</${escapeRegExp(tagName)}>`, 'i');
   const match = xml.match(regex);
   if (!match?.[1]) return null;
   return cleanString(match[1]);
}

function extractWindowsPathsFromText(text: string): string[] {
   const regex = /(?:\\\\\?\\)?[A-Za-z]:\\[^\r\n]+/g;
   const output: string[] = [];

   let match: RegExpExecArray | null = null;
   while ((match = regex.exec(text)) !== null) {
      const cleaned = cleanWerPath(match[0]);
      if (cleaned) output.push(cleaned);
   }

   return uniqueStrings(output);
}

function extractWindowsPathsFromProperties(props: string[]): string[] {
   const output: string[] = [];
   for (const p of props) {
      output.push(...extractWindowsPathsFromText(p));
   }
   return uniqueStrings(output);
}

function cleanWerPath(input: string): string {
   return input
      .trim()
      .replace(/^\\\\\?\\/, '')
      .replace(/^"|"$/g, '')
      .replace(/[\x00-\x1F]+/g, '')
      .trim();
}

function normalizeWerVersion(input: string | null | undefined): string | null {
   const value = cleanString(input);
   if (!value) return null;

   if (/^\d+_\d+_\d+/.test(value)) {
      return value.replace(/_/g, '.');
   }

   const match = value.match(/\d+\.\d+(?:\.\d+){1,3}/);
   if (match) return match[0];
   return null;
}

function normalizeWerBuild(input: string | null | undefined): string | null {
   const value = cleanString(input);
   if (!value) return null;

   if (/^\d+_\d+_\d+/.test(value)) {
      const parts = value.split('_');
      return parts[2] ?? null;
   }

   const match = value.match(/\b(\d{4,6})\b/);
   return match?.[1] ?? null;
}

function normalizeExeName(input: string | null | undefined): string | null {
   const value = cleanString(input);
   if (!value) return null;

   const match = value.match(/[A-Za-z0-9_. -]{1,120}\.exe/i);
   if (!match) return null;

   return match[0]
      .replace(/[\x00-\x1F]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
}

function normalizeImageName(input: string | null | undefined): string | null {
   const value = cleanString(input);
   if (!value) return null;

   const match = value.match(/[A-Za-z0-9_. -]{1,120}\.(?:exe|sys)/i);
   if (!match) return null;

   return match[0]
      .replace(/[\x00-\x1F]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
}

function normalizeDllName(input: string | null | undefined): string | null {
   const value = cleanString(input);
   if (!value) return null;

   const match = value.match(/[A-Za-z0-9_. -]{1,120}\.dll/i);
   return match?.[0]?.trim() ?? null;
}

function isLikelyDumpOrWerPath(input: string): boolean {
   return /\.dmp$|\.wer$|\.xml$/i.test(input) || /\\WER\\/i.test(input);
}

function looksLikeGuid(value: string): boolean {
   return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
   for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
         const value = cleanString(match[1]);
         if (value) return value;
      }
   }
   return null;
}

function firstNonEmpty<T extends string | null | undefined>(...values: T[]): string | null {
   for (const value of values) {
      const cleaned = cleanString(value);
      if (cleaned) return cleaned;
   }
   return null;
}

function cleanString(value: unknown): string | null {
   if (value == null) return null;
   const text = String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '').trim();
   return text || null;
}

function uniqueStrings(input: Array<string | null | undefined>): string[] {
   const seen = new Set<string>();
   const output: string[] = [];

   for (const item of input) {
      const clean = cleanString(item);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(clean);
   }

   return output;
}

function normalizeToArray<T>(input: T[] | T | null): T[] {
   if (input == null) return [];
   return Array.isArray(input) ? input : [input];
}

function escapeRegExp(value: string): string {
   return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
