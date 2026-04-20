import { runCommand } from '@/modules/shell';
import { IS_WINDOWS } from '@/modules/env';

export async function runPowerShellJson<T>(script: string): Promise<T | null> {
   try {
      const stdout = await runCommand('powershell', [
         '-NoProfile',
         '-ExecutionPolicy',
         'Bypass',
         '-Command',
         script,
      ]);

      const cleaned = stdout.trim();
      if (!cleaned) return null;
      return JSON.parse(cleaned) as T;
   } catch {
      return null;
   }
}

export async function isAdministratorSession(): Promise<boolean> {
   if (!IS_WINDOWS) return false;

   const script = [
      '$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())',
      '$currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) | ConvertTo-Json -Compress',
   ].join('; ');

   const result = await runPowerShellJson<boolean>(script);
   return result === true;
}

/**
 * Parses a PowerShell date string which can be in ISO format or /Date(1234567890)/ format.
 * Returns a Date object or null if parsing fails.
 */
export function parsePwshDate(str: string): Date | null {
   if (!str) return null;
   if (str.startsWith('/Date(')) {
      const timestamp = parseInt(str.slice(6, str.indexOf(')')), 10);
      if (Number.isFinite(timestamp)) {
         return new Date(timestamp);
      }
   } else {
      const date = new Date(str);
      if (!isNaN(date.getTime())) {
         return date;
      }
   }
   return null;
}
