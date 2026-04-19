import { ncc } from '@lib/Tools';

import { CommandModule } from '@/common';
import { error, quickPrint } from '@/modules/shell';
import { formatDateTime, relativeFromNow } from '@/modules/date';
import { resolveEventById } from '@/modules/events';
import { getBugcheckInfo } from '@/modules/bugcheck-reference';
import { BugCheckReferenceEntry } from '@/types';
import { CrashEventEntity } from '@/entities/CrashEvent';
import { COLOR_PALETTE } from '@/consts';

const cmd: CommandModule = {
   async run(ctx) {
      const format = (ctx.args.popValue('--format') ?? 'default').toLowerCase();
      const id = ctx.args[0];

      if (!id) {
         error('Missing <id>. Example: yabsod view abcd or yabsod view ~1');
         return 1;
      }

      const event = await resolveEventById(id);
      if (!event) {
         error(`Crash event '${id}' not found (or not unique).`);
         return 1;
      }

      const bugcheckInfo =
         event.crashType === 'bsod'
            ? await getBugcheckInfo({ code: event.bugCheckCode, name: event.bugCheckName })
            : null;

      if (format === 'json') {
         const payload = {
            event,
            bugcheckInfo,
         };
         quickPrint(JSON.stringify(payload, null, 2));
         return 0;
      }

      if (format === 'md') {
         quickPrint(renderMarkdown(event, bugcheckInfo));
         return 0;
      }

      quickPrint(renderDefault(event, bugcheckInfo));
      return 0;
   },
   help: {
      short: 'View detailed crash event data.',
      usage: 'yabsod view <id|~N> [--format default|json|md]',
      long: 'Shows full crash record, related logs/dumps, and bugcheck description when applicable.',
   },
};

function renderDefault(
   event: CrashEventEntity,
   bugcheckInfo: BugCheckReferenceEntry | null
): string {
   const lines: string[] = [];
   lines.push(`${ncc('Bright')}${ncc('Cyan')}Crash Event${ncc()} ${event.shortId}`);
   lines.push(
      `Type: ${event.crashType === 'bsod' ? `${ncc(COLOR_PALETTE.blue600)}BSOD${ncc()}` : `${ncc(COLOR_PALETTE.rose600)}App crash${ncc()}`}`
   );
   lines.push(`When: ${formatDateTime(event.timestamp)} (${relativeFromNow(event.timestamp)})`);
   lines.push(`Hash: ${event.hashId}`);

   if (event.crashType === 'app') {
      lines.push(`Application: ${event.applicationName || 'UnknownApp'}`);
   } else {
      lines.push(`BugCheck: ${event.bugCheckName || event.bugCheckCode || 'UnknownBugCheck'}`);
      lines.push(`Code: ${event.bugCheckCode || 'N/A'}`);
      lines.push(`Process: ${event.processName || 'UnknownProcess'}`);
   }

   if (event.reportId) lines.push(`Report ID: ${event.reportId}`);
   if (event.reportStatus) lines.push(`Report status: ${event.reportStatus}`);
   if (event.osVersion || event.osBuild)
      lines.push(`OS: ${event.osVersion || 'unknown'} ${event.osBuild || ''}`.trim());
   if (event.driverVersion) lines.push(`Driver version: ${event.driverVersion}`);

   if (bugcheckInfo) {
      lines.push('');
      lines.push(`${ncc('Bright')}BugCheck Reference${ncc()}`);
      lines.push(`Name: ${bugcheckInfo.name}`);
      lines.push(`Code: ${bugcheckInfo.codeHex}`);
      if (typeof bugcheckInfo.codeDec === 'number') {
         lines.push(`Code (dec): ${bugcheckInfo.codeDec}`);
      }
      lines.push(`Description: ${bugcheckInfo.description}`);
      if (bugcheckInfo.cause) {
         lines.push(`Cause: ${bugcheckInfo.cause}`);
      }
      if (bugcheckInfo.resolution) {
         lines.push(`Resolution: ${bugcheckInfo.resolution}`);
      }
      if (bugcheckInfo.remarks) {
         lines.push(`Remarks: ${bugcheckInfo.remarks}`);
      }
      if (Array.isArray(bugcheckInfo.parameters) && bugcheckInfo.parameters.length > 0) {
         lines.push('Parameters:');
         for (const parameter of bugcheckInfo.parameters.slice(0, 8)) {
            lines.push(`  - ${parameter}`);
         }
      }
      if (typeof bugcheckInfo.infrequent === 'boolean') {
         lines.push(`Infrequent: ${bugcheckInfo.infrequent ? 'Yes' : 'No'}`);
      }
      if (bugcheckInfo.sourceUrl) {
         lines.push(`Source: ${bugcheckInfo.sourceUrl}`);
      }
   }

   if (event.dumpPaths?.length) {
      lines.push('');
      lines.push(`${ncc('Bright')}Related Dump Files${ncc()}`);
      for (const dumpPath of event.dumpPaths) {
         lines.push(`  - ${dumpPath}`);
      }
   }

   if (event.relatedEventLogs?.length) {
      lines.push('');
      lines.push(`${ncc('Bright')}Related Event Entries${ncc()}`);
      for (const item of event.relatedEventLogs.slice(0, 8)) {
         lines.push(`  - ${String(item).slice(0, 500)}`);
      }
   }

   if (event.stackTrace) {
      lines.push('');
      lines.push(`${ncc('Bright')}Stack Trace${ncc()}`);
      lines.push(event.stackTrace);
   }

   if (event.rawPayload) {
      lines.push('');
      lines.push(`${ncc('Bright')}Raw Payload${ncc()}`);
      lines.push(event.rawPayload);
   }

   return lines.join('\n');
}

function renderMarkdown(
   event: CrashEventEntity,
   bugcheckInfo: BugCheckReferenceEntry | null
): string {
   const lines: string[] = [];
   lines.push(`# YABSOD Crash Event ${event.shortId}`);
   lines.push('');
   lines.push(`- Type: ${event.crashType}`);
   lines.push(
      `- Timestamp: ${formatDateTime(event.timestamp)} (${relativeFromNow(event.timestamp)})`
   );
   lines.push(`- Hash: ${event.hashId}`);

   if (event.crashType === 'app') {
      lines.push(`- Application: ${event.applicationName || 'UnknownApp'}`);
   } else {
      lines.push(`- BugCheck: ${event.bugCheckName || event.bugCheckCode || 'UnknownBugCheck'}`);
      lines.push(`- Code: ${event.bugCheckCode || 'N/A'}`);
      lines.push(`- Process: ${event.processName || 'UnknownProcess'}`);
   }

   if (bugcheckInfo) {
      lines.push('');
      lines.push('## BugCheck Reference');
      lines.push(`- Name: ${bugcheckInfo.name}`);
      lines.push(`- Code: ${bugcheckInfo.codeHex}`);
      if (typeof bugcheckInfo.codeDec === 'number') {
         lines.push(`- Code (dec): ${bugcheckInfo.codeDec}`);
      }
      lines.push(`- Description: ${bugcheckInfo.description}`);
      if (bugcheckInfo.cause) {
         lines.push(`- Cause: ${bugcheckInfo.cause}`);
      }
      if (bugcheckInfo.resolution) {
         lines.push(`- Resolution: ${bugcheckInfo.resolution}`);
      }
      if (bugcheckInfo.remarks) {
         lines.push(`- Remarks: ${bugcheckInfo.remarks}`);
      }
      if (Array.isArray(bugcheckInfo.parameters) && bugcheckInfo.parameters.length > 0) {
         lines.push('- Parameters:');
         for (const parameter of bugcheckInfo.parameters.slice(0, 8)) {
            lines.push(`  - ${parameter}`);
         }
      }
      if (typeof bugcheckInfo.infrequent === 'boolean') {
         lines.push(`- Infrequent: ${bugcheckInfo.infrequent ? 'Yes' : 'No'}`);
      }
      if (bugcheckInfo.sourceUrl) {
         lines.push(`- Source: ${bugcheckInfo.sourceUrl}`);
      }
   }

   if (event.dumpPaths?.length) {
      lines.push('');
      lines.push('## Dump Files');
      for (const dumpPath of event.dumpPaths) {
         lines.push(`- ${dumpPath}`);
      }
   }

   if (event.relatedEventLogs?.length) {
      lines.push('');
      lines.push('## Related Event Entries');
      for (const item of event.relatedEventLogs.slice(0, 8)) {
         lines.push(`- ${String(item).slice(0, 500)}`);
      }
   }

   if (event.stackTrace) {
      lines.push('');
      lines.push('## Stack Trace');
      lines.push('```text');
      lines.push(event.stackTrace);
      lines.push('```');
   }

   if (event.rawPayload) {
      lines.push('');
      lines.push('## Raw Payload');
      lines.push('```text');
      lines.push(event.rawPayload);
      lines.push('```');
   }

   return lines.join('\n');
}

export default cmd;
