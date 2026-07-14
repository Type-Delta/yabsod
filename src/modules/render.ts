import { CheckCache, MathKit, ncc, strWrap } from '@lib/Tools';

import { StatsSummary } from '@/types';
import { COLOR_PALETTE } from '@/consts';
import { colorMixD } from './graphics';

export interface ProgressBarOptions {
   width?: number;
   color?: Parameters<typeof ncc>[0];
   progressNumber?: 'pct' | 'fraction' | 'none';
}

export type HorizontalBarOptions = Omit<ProgressBarOptions, 'progressNumber'> & {
   /** Labels longer than this are stacked on their own line above the bar. */
   maxLabel?: number;
};

/**
 * Calm section header: `── Title ────────────`
 * Dim rule with a bright title, the shared visual anchor of every command.
 */
export function header(title: string, width = 48): string {
   const dim = ncc('Dim');
   const reset = ncc();
   const tail = Math.max(2, width - stripAnsi(title).length - 5);
   return `${dim}──${reset} ${ncc('Bright')}${title}${reset} ${dim}${'─'.repeat(tail)}${reset}`;
}

/**
 * Aligned key/value rows with dim keys:
 * ```
 * today      3
 * all-time   128
 * ```
 */
export function kv(rows: Array<[string, string]>, indent = ''): string {
   const pad = Math.max(...rows.map(([key]) => key.length), 0);
   return rows
      .map(([key, value]) => `${indent}${ncc('Dim')}${key.padEnd(pad)}${ncc()}  ${value}`)
      .join('\n');
}

/**
 * Rounded panel with a dim border and the title embedded in the top edge:
 * ```
 * ╭─ Title ─────────╮
 * │ content         │
 * ╰─────────────────╯
 * ```
 * Every returned line is exactly `width` visible characters wide.
 */
export function panel(title: string, content: string, width = 36): string {
   const dim = ncc('Dim');
   const reset = ncc();
   const inner = width - 4;

   const lines = content
      .split('\n')
      .flatMap((line) =>
         stripAnsi(line).length > inner
            ? strWrap(line, inner, { mode: 'strict' }).split('\n')
            : [line]
      );

   const titleLen = title ? stripAnsi(title).length + 2 : 0;
   const top = title
      ? `${dim}╭─${reset} ${ncc('Bright')}${title}${reset} ${dim}${'─'.repeat(Math.max(0, width - titleLen - 3))}╮${reset}`
      : `${dim}╭${'─'.repeat(width - 2)}╮${reset}`;
   const bottom = `${dim}╰${'─'.repeat(width - 2)}╯${reset}`;
   const body = lines.map((line) => `${dim}│${reset} ${padAnsi(line, inner)} ${dim}│${reset}`);

   return [top, ...body, bottom].join('\n');
}

/**
 * Lays fixed-width panels out in columns that fit the terminal.
 * Panels must have uniform visible width (as produced by `panel()`).
 */
export function panelGrid(panels: string[], termWidth: number, panelWidth: number, gap = 2): string {
   if (panels.length === 0) return '';
   const cols = Math.max(1, Math.floor((termWidth + gap) / (panelWidth + gap)));
   if (cols === 1) return panels.join('\n');

   const blocks = panels.map((p) => p.split('\n'));
   const rows: string[] = [];
   for (let i = 0; i < blocks.length; i += cols) {
      const chunk = blocks.slice(i, i + cols);
      const maxLines = Math.max(...chunk.map((lines) => lines.length));
      for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
         rows.push(
            chunk
               .map((lines) => padAnsi(lines[lineIndex] ?? '', panelWidth))
               .join(' '.repeat(gap))
               .trimEnd()
         );
      }
   }
   return rows.join('\n');
}

export function formatCount(value: number): string {
   return new Intl.NumberFormat('en-US').format(value);
}

export function progressBar(value: number, total: number, options: ProgressBarOptions = {}): string {
   const { width: _width, color = 'White', progressNumber = 'pct' } = options;
   const ratio = total <= 0 ? 0 : MathKit.clamp(value / total, 0, 1);

   let progressText = '';
   switch (progressNumber) {
      case 'pct':
         progressText = `${Math.round(ratio * 100)}%`;
         break;
      case 'fraction':
         progressText = `${formatCount(value)}/${formatCount(total)}`;
         break;
      case 'none':
      default:
         break;
   }

   const width = Math.max((_width ?? 28) - progressText.length - 1, progressText.length + 5);
   const exact = width * ratio;
   const full = Math.floor(exact);
   const hasPartial = exact > full && full < width;
   const supportsColor = !!CheckCache.supportsColor;
   const emptyBarChar = supportsColor ? ncc() + ncc('Dim') + '━' : '╸';

   const bar = new Array(width).fill(emptyBarChar) as string[];
   for (let i = 0; i < full; i++) {
      if (i === 0 && supportsColor && color != null) {
         bar[i] = `${ncc(color)}━`;
         continue;
      }

      bar[i] = '━';
   }

   if (hasPartial) {
      bar[full] = supportsColor && color != null ? emptyBarChar + ncc() + ncc('Dim') : emptyBarChar;
   }

   return `${bar.join('') + ncc()} ${progressText}`.trim();
}

export function horizontalBars(
   title: string,
   rows: Array<{ label: string; count: number }>,
   options: HorizontalBarOptions = {}
): string {
   const { color = 'White', width = 28, maxLabel = 18 } = options;

   if (rows.length === 0) {
      return `${header(title)}\n  ${ncc('Dim')}none yet${ncc()}`;
   }

   const max = Math.max(...rows.map((row) => row.count), 1);
   const inlineRows = rows.filter((row) => row.label.length <= maxLabel);
   const labelPad = Math.max(...inlineRows.map((row) => row.label.length), 3);
   const lines = rows.flatMap((row) => {
      const barLen = Math.max(1, Math.round((row.count / max) * width));
      const rest = width - barLen;
      const bar = `${ncc(color)}${'▮'.repeat(barLen)}${ncc('Dim')}${'▯'.repeat(rest)}${ncc()}  ${row.count}`;

      if (row.label.length > maxLabel) {
         return [
            `  ${ncc('Dim')}${row.label}${ncc()}`,
            `  ${' '.repeat(labelPad)}  ${bar}`,
         ];
      }

      return [`  ${ncc('Dim')}${row.label.padEnd(labelPad)}${ncc()}  ${bar}`];
   });

   return `${header(title)}\n${lines.join('\n')}`;
}

export function renderHeatmap(summary: StatsSummary, maxWeeks = 52, width = 100): string {
   const COL_WIDTH = 2; // '■ '
   const LABEL_WIDTH = 4; // 'Mo  '
   const weeks = Math.max(1, Math.min(maxWeeks, Math.floor((width - LABEL_WIDTH) / COL_WIDTH) - 1));

   const dayMap = new Map(summary.heatmapDays.map((entry) => [entry.date, entry]));
   const today = new Date();
   today.setHours(0, 0, 0, 0);
   const start = new Date(today);
   start.setDate(start.getDate() - start.getDay()); // align to last Sunday
   start.setDate(start.getDate() - weeks * 7);

   const rows: string[] = [];
   rows.push(header('Crash Heatmap'));
   rows.push('');

   // month labels along the x axis
   let monthLine = ' '.repeat(LABEL_WIDTH);
   let nextFreeIndex = 0;
   let prevMonth = -1;
   for (let week = 0; week <= weeks; week++) {
      const weekStart = new Date(start);
      weekStart.setDate(start.getDate() + week * 7);
      const targetIndex = week * COL_WIDTH;

      if (weekStart.getMonth() !== prevMonth && targetIndex >= nextFreeIndex) {
         monthLine += ' '.repeat(targetIndex - nextFreeIndex);
         const monthStr = weekStart.toLocaleString('default', { month: 'short' });
         monthLine += monthStr.padEnd(COL_WIDTH * 3);
         nextFreeIndex = targetIndex + COL_WIDTH * 3;
         prevMonth = weekStart.getMonth();
      }
   }
   rows.push(`${ncc('Dim')}${monthLine.trimEnd()}${ncc()}`);

   // sparse day-of-week labels on the y axis
   const dayLabels = ['', 'Mo', '', 'We', '', 'Fr', ''];
   for (let weekday = 0; weekday < 7; weekday++) {
      let line = `${ncc('Dim')}${dayLabels[weekday].padEnd(LABEL_WIDTH)}${ncc()}`;
      for (let week = 0; week <= weeks; week++) {
         const date = new Date(start);
         date.setDate(start.getDate() + week * 7 + weekday);
         if (date > today) {
            line += '  ';
            continue;
         }
         const entry = dayMap.get(toDateKey(date));
         line += renderHeatCell(entry?.bsod ?? 0, entry?.app ?? 0) + ' ';
      }
      rows.push(line.trimEnd());
   }

   rows.push(
      `Legend: ${ncc(COLOR_PALETTE.blue600)}■${ncc()} bsod ${ncc(COLOR_PALETTE.rose600)}■${ncc()} app ${ncc(colorMixD(COLOR_PALETTE.rose600, COLOR_PALETTE.blue600, 0.5))}■${ncc()} mixed`
   );
   return rows.join('\n');
}

function renderHeatCell(bsod: number, app: number): string {
   if (bsod === 0 && app === 0) {
      return `${ncc('Dim')}▢${ncc()}`;
   }

   const total = bsod + app;
   if (bsod > 0 && app === 0) {
      const intensity = MathKit.clamp(bsod / 4, 0.25, 1);
      const blue = colorMixD(COLOR_PALETTE.gray400, COLOR_PALETTE.blue600, intensity);
      return `${ncc(blue)}■${ncc()}`;
   }

   if (app > 0 && bsod === 0) {
      const intensity = MathKit.clamp(app / 4, 0.25, 1);
      const red = colorMixD(COLOR_PALETTE.gray400, COLOR_PALETTE.rose600, intensity);
      return `${ncc(red)}■${ncc()}`;
   }

   const ratio = bsod / total;
   const mixed = colorMixD(COLOR_PALETTE.rose600, COLOR_PALETTE.blue600, ratio);
   return `${ncc(mixed)}■${ncc()}`;
}

/** Widest visible (ANSI-stripped) line in a multi-line block. */
export function visibleWidth(block: string): number {
   return Math.max(...block.split('\n').map((line) => stripAnsi(line).length), 0);
}

export function padAnsi(value: string, target: number): string {
   const visible = stripAnsi(value).length;
   const pad = Math.max(0, target - visible);
   return value + ' '.repeat(pad);
}

function stripAnsi(value: string): string {
   return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function toDateKey(date: Date): string {
   return date.toISOString().slice(0, 10);
}

