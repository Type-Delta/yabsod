export function formatDateTime(ts: number): string {
   const date = new Date(ts);
   return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
   });
}

export function formatHour(hour: number): string {
   const d = new Date();
   d.setHours(hour, 0, 0, 0);
   return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      hour12: true,
   });
}

export function relativeFromNow(ts: number): string {
   const diff = Date.now() - ts;
   const abs = Math.abs(diff);

   const units: Array<{ ms: number; label: string }> = [
      { ms: 365 * 24 * 60 * 60 * 1000, label: 'year' },
      { ms: 30 * 24 * 60 * 60 * 1000, label: 'month' },
      { ms: 24 * 60 * 60 * 1000, label: 'day' },
      { ms: 60 * 60 * 1000, label: 'hour' },
      { ms: 60 * 1000, label: 'minute' },
      { ms: 1000, label: 'second' },
   ];

   for (const unit of units) {
      const value = Math.floor(abs / unit.ms);
      if (value >= 1) {
         const suffix = value === 1 ? '' : 's';
         return diff >= 0
            ? `${value} ${unit.label}${suffix} ago`
            : `in ${value} ${unit.label}${suffix}`;
      }
   }

   return 'just now';
}
