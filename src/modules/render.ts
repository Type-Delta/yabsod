import { CheckCache, MathKit, ncc, strWrap } from '@lib/Tools';

import { StatsSummary } from '@/types';
import { COLOR_PALETTE } from '@/consts';
import { colorMixD } from './graphics';

export interface ProgressBarOptions {
   width?: number;
   color?: Parameters<typeof ncc>[0];
   progressNumber?: 'pct' | 'fraction' | 'none';
}

export type HorizontalBarOptions = Omit<ProgressBarOptions, 'progressNumber'>;

export function header(title: string): string {
   return `${ncc('Bright')}${ncc('Cyan')}${title}${ncc()}`;
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
   const { color = 'White', width = 28 } = options;

   if (rows.length === 0) {
      return `${header(title)}\n  none yet`;
   }

   const max = Math.max(...rows.map((row) => row.count), 1);
   const labelPad = Math.max(...rows.map((row) => row.label.length), 3);
   const lines = rows.map((row) => {
      const barLen = Math.max(1, Math.round((row.count / max) * width));
      return `  ${row.label.padEnd(labelPad)} ${ncc(color)}${'█'.repeat(barLen)}${ncc()} ${row.count}`;
   });

   return `${header(title)}\n${lines.join('\n')}`;
}

export function renderHeatmap(summary: StatsSummary, weeks = 18): string {
   const dayMap = new Map(summary.heatmapDays.map((entry) => [entry.date, entry]));
   const now = new Date();
   const start = new Date(now);
   start.setDate(start.getDate() - weeks * 7);
   start.setHours(0, 0, 0, 0);

   const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
   const rows: string[] = [];
   rows.push(header('Crash Heatmap'));
   rows.push('    ' + dayLabels.join(' '));

   for (let weekday = 0; weekday < 7; weekday++) {
      let line = `${dayLabels[weekday]}  `;
      for (let week = 0; week < weeks; week++) {
         const date = new Date(start);
         date.setDate(start.getDate() + week * 7 + weekday);
         const key = toDateKey(date);
         const entry = dayMap.get(key);
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

export function renderCardGrid(cards: string[], termWidth: number): string {
   if (cards.length === 0) return '';
   const colGap = 3;
   const cols = termWidth >= 150 ? 3 : termWidth >= 100 ? 2 : 1;
   if (cols === 1) return cards.join('\n\n');

   const colWidth = Math.floor((termWidth - (cols - 1) * colGap) / cols);
   const normalized = cards.map((card) =>
      strWrap(card, colWidth, {
         mode: 'softboundary',
      }).split('\n')
   );

   const rows: string[] = [];
   for (let i = 0; i < normalized.length; i += cols) {
      const chunk = normalized.slice(i, i + cols);
      const maxLines = Math.max(...chunk.map((lines) => lines.length));

      for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
         const line = chunk
            .map((lines) => {
               const value = lines[lineIndex] ?? '';
               return padAnsi(value, colWidth);
            })
            .join(' '.repeat(colGap));
         rows.push(line);
      }

      rows.push('');
   }

   return rows.join('\n').trimEnd();
}

function padAnsi(value: string, target: number): string {
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

