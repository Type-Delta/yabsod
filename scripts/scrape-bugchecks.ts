import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { normalizeBugCheckCode, normalizeBugCheckName } from '@/modules/hash';

const LIST_URL =
   'https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-code-reference2';

const rowRegex =
   /<a[^>]+href="(?<href>[^"]+)"[^>]*>(?<title>[^<]+)<\/a>[\s\S]*?<td[^>]*>(?<code>0x[0-9A-Fa-f]+|\d+)<\/td>/g;

const EntrySchema = z.object({
   codeHex: z.string(),
   codeDec: z.number().optional(),
   name: z.string(),
   description: z.string(),
   possibleCauses: z.array(z.string()).optional(),
   infrequent: z.boolean().optional(),
   sourceUrl: z.string().optional(),
});

type Entry = z.infer<typeof EntrySchema>;

async function main(): Promise<void> {
   const res = await fetch(LIST_URL, {
      headers: {
         'user-agent': 'yabsod-bugcheck-scraper/0.0.1',
      },
   });

   if (!res.ok) {
      throw new Error(`Failed to fetch ${LIST_URL}: ${res.status} ${res.statusText}`);
   }

   const html = await res.text();
   const found: Entry[] = [];
   const seen = new Set<string>();

   for (const match of html.matchAll(rowRegex)) {
      const title = decodeHtml(match.groups?.title || '').trim();
      const codeRaw = (match.groups?.code || '').trim();
      if (!title || !codeRaw) continue;

      const normalizedCode = normalizeBugCheckCode(codeRaw);
      const normalizedName = normalizeBugCheckName(title);
      const key = `${normalizedCode}|${normalizedName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const href = match.groups?.href || '';
      const url = href.startsWith('http')
         ? href
         : `https://learn.microsoft.com${href.startsWith('/') ? '' : '/'}${href}`;

      const detail = await fetchDetail(url).catch(() => ({
         description: `${title} bug check`,
         possibleCauses: [],
         infrequent: false,
      }));

      found.push({
         codeHex: normalizedCode,
         codeDec: parseDec(codeRaw),
         name: normalizedName,
         description: detail.description,
         possibleCauses: detail.possibleCauses,
         infrequent: detail.infrequent,
         sourceUrl: url,
      });
   }

   const validated = EntrySchema.array().parse(found);
   validated.sort((a, b) => a.codeHex.localeCompare(b.codeHex));

   const outPath = path.resolve(process.cwd(), 'resources', 'bugcheck-reference.json');
   await fs.writeFile(outPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');

   console.log(`Saved ${validated.length} bugcheck entries to ${outPath}`);
}

async function fetchDetail(url: string): Promise<{
   description: string;
   possibleCauses: string[];
   infrequent: boolean;
}> {
   const res = await fetch(url, {
      headers: {
         'user-agent': 'yabsod-bugcheck-scraper/0.0.1',
      },
   });

   if (!res.ok) {
      throw new Error(`Failed to fetch detail ${url}`);
   }

   const html = await res.text();
   const text = stripHtml(html);

   const description = firstParagraph(text) || 'Bug check reference entry';
   const possibleCauses = extractBulletItems(text).slice(0, 8);
   const infrequent = /appears very infrequently/i.test(text);

   return {
      description,
      possibleCauses,
      infrequent,
   };
}

function parseDec(input: string): number | undefined {
   if (input.startsWith('0x') || input.startsWith('0X')) {
      const value = Number.parseInt(input.slice(2), 16);
      return Number.isNaN(value) ? undefined : value;
   }
   const value = Number.parseInt(input, 10);
   return Number.isNaN(value) ? undefined : value;
}

function decodeHtml(value: string): string {
   return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
}

function stripHtml(html: string): string {
   return decodeHtml(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

function firstParagraph(text: string): string {
   return text.split('. ').slice(0, 2).join('. ').slice(0, 320);
}

function extractBulletItems(text: string): string[] {
   const results: string[] = [];
   const sentences = text.split('. ');
   for (const sentence of sentences) {
      if (/cause|caused|usually|typically|may be/i.test(sentence)) {
         const cleaned = sentence.trim();
         if (cleaned.length > 15 && cleaned.length < 200) {
            results.push(cleaned);
         }
      }
      if (results.length >= 12) break;
   }
   return results;
}

main().catch((err) => {
   console.error(err);
   process.exit(1);
});
