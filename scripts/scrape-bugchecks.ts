import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { z } from 'zod';

import { normalizeBugCheckCode, normalizeBugCheckName } from '@/modules/hash';
import { spinner } from '@/modules/shell';
import { conncurrent } from '@/modules/operation';

const BASE_URL = 'https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger';
const LIST_URL = `${BASE_URL}/bug-check-code-reference2`;
const DUMP_DIR = path.resolve(process.cwd(), 'dump');
const bugCheckCodeTrsSelector = 'h2[id$="bug-check-codes"] ~ table > tbody > tr';
const bugCheckDetailArticleSelector = 'main div.content:has(p ~ p)';
const bugCheckDetailArticleParamsSelector = 'h2[id$="parameters"] + table tr td:last-child';
const bugCheckDetailArticleCauseSelector = 'h2[id="cause"] + p';
const bugCheckDetailArticleRemarksSelector = 'h2[id="remarks"] + p';
const bugCheckDetailArticleResolutionSelector = 'h2[id="resolution"] + p';
const headers = {
   'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0',
   'Accept-Language': 'en-US,en;q=0.5',
   'Host': 'learn.microsoft.com',
   'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
}

const EntrySchema = z.object({
   codeHex: z.string(),
   codeDec: z.number().optional(),
   name: z.string(),
   description: z.string(),
   cause: z.string().optional(),
   resolution: z.string().optional(),
   remarks: z.string().optional(),
   parameters: z.array(z.string()).optional(),
   infrequent: z.boolean().optional(),
   sourceUrl: z.string().optional(),
});

type Entry = z.infer<typeof EntrySchema>;
type BugCheckDetails = Pick<Entry, 'description' | 'cause' | 'resolution' | 'remarks' | 'parameters' | 'infrequent'>;

async function main(): Promise<void> {
   await fs.mkdir(DUMP_DIR, { recursive: true });

   const spinnerCtrl = spinner({ message: 'Fetching bug check list...' });
   const res = await fetch(LIST_URL, {
      headers,
   });

   if (!res.ok) {
      throw new Error(`Failed to fetch ${LIST_URL}: ${res.status} ${res.statusText}`);
   }

   const html = await res.text();
   // const html = await fs.readFile('./html-dump.html', 'utf8');
   await fs.writeFile(path.join(DUMP_DIR, 'bugcheck-list.html'), html, 'utf8');
   const found: Entry[] = [];
   const seen = new Set<string>();
   const { document } = parseHTML(html);
   const bugCheckCodeTrs = document.body.querySelectorAll<HTMLTableRowElement>(bugCheckCodeTrsSelector);

   spinnerCtrl.setMessage(`Fetching bug check details... (0/${bugCheckCodeTrs.length})`);

   /**
    * Example row:
    * <tr>
    * <td>0x0000009F</td>
    * <td><a href="bug-check-0x9f--driver-power-state-failure" data-linktype="relative-path">
    *    <strong>DRIVER_POWER_STATE_FAILURE</strong></a></td>
    * </tr>
    */
   await conncurrent([...bugCheckCodeTrs], async (node) => {
      const linkEl = node.querySelector('td a[href^="bug-check-"]');

      const title = linkEl?.textContent?.trim() || '';
      const codeRaw = node.querySelector('td')?.textContent?.trim() || '';
      if (!title || !codeRaw) return;

      const normalizedCode = normalizeBugCheckCode(codeRaw);
      const normalizedName = normalizeBugCheckName(title);
      const key = `${normalizedCode}|${normalizedName}`;
      if (seen.has(key)) return;
      seen.add(key);

      const href = linkEl?.getAttribute('href') || '';
      const url = href.startsWith('http')
         ? href
         : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

      try {
         const detail = await fetchDetail(url);
         found.push({
            codeHex: normalizedCode,
            codeDec: parseDec(codeRaw),
            name: normalizedName,
            sourceUrl: url,
            ...detail,
         });
      } catch (err) {
         spinnerCtrl.stop();
         console.warn(`Failed to fetch detail for ${normalizedCode} ${normalizedName} at ${url}: ${(err as Error).message}`);
         spinnerCtrl.start(false);
         found.push({
            codeHex: normalizedCode,
            codeDec: parseDec(codeRaw),
            name: normalizedName,
            sourceUrl: url,
            description: 'UNAVAILABLE',
         });
      }

      spinnerCtrl.options.message = `Fetching bug check details... (${found.length}/${bugCheckCodeTrs.length})`;
   }, 3);

   spinnerCtrl.stop();

   const validated = EntrySchema.array().parse(found);
   validated.sort((a, b) => a.codeHex.localeCompare(b.codeHex));

   const outPath = path.resolve(process.cwd(), 'resources', 'bugcheck-reference.json');
   await fs.writeFile(outPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');

   console.log(`Saved ${validated.length} bugcheck entries to ${outPath}`);
}

async function fetchDetail(url: string): Promise<BugCheckDetails> {
   let html: string;
   if (url.startsWith('http')) {
      const res = await fetch(url, {
         headers,
      });

      if (!res.ok) {
         throw new Error(`Failed to fetch page ${url}, server responded with ${res.status} ${res.statusText}`);
      }
      html = await res.text();
      await fs.writeFile(path.join(DUMP_DIR, `bugcheck-details-${url.split('/').pop()}.html`), html, 'utf8');
   }
   else {
      html = await fs.readFile(url, 'utf8');
   }

   const { document } = parseHTML(html);
   const article = document.body.querySelector(bugCheckDetailArticleSelector);
   if (!article) {
      throw new Error(`Failed to find article body in ${url}`);
   }

   // Parse description. The description is usually in the first few <p> tags, we don't know exactly,
   // but we know that after the description, there will be a <div> or <h2> tag. So we can use that as a marker to stop parsing description.
   // while parsing we might as well tap into the content to check bug check infrequency hints.
   let isInfrequent = false;
   const descriptionEls = [...article.children]
      .filter((el) => el.tagName === 'P' || el.tagName === 'DIV' || el.tagName === 'H2');
   let nonPSkipped = 0, seenP = false;
   const nonPElIndex = descriptionEls.findIndex((el) => {
      if (el.tagName !== 'P' && !seenP) {
         nonPSkipped++;
         return false;
      }
      if (el.tagName === 'P') {
         seenP = true;
         return false;
      }
      return seenP;
   });
   const description = descriptionEls
      .filter((el) => el.tagName === 'P')
      .slice(0, nonPElIndex === -1 ? 1 : nonPElIndex - nonPSkipped) // if no non-P element found, just take the first <p> as description
      .map((el) => el.textContent?.trim())
      .filter((v): v is string => {
         if (/appears very infrequently/i.test(v))
            isInfrequent = true;
         return !!v;
      })
      .join('\n\n');

   if (!description) {
      throw new Error(`Failed to extract description from ${url}`);
   }

   const parameters = [...article.querySelectorAll<HTMLElement>(bugCheckDetailArticleParamsSelector)]
      .map((el) => serializeHtml(el.innerHTML));
   const cause = article.querySelector(bugCheckDetailArticleCauseSelector)?.textContent?.trim();
   const resolution = article.querySelector(bugCheckDetailArticleResolutionSelector)?.textContent?.trim();
   const remarks = article.querySelector(bugCheckDetailArticleRemarksSelector)?.textContent?.trim();

   return {
      description,
      cause,
      resolution,
      remarks,
      parameters,
      infrequent: isInfrequent,
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
      .replace(/&#39;/g, "'")
      .replace(/<br\s*\/?>/gi, '\n');
}

function serializeHtml(html: string): string {
   return decodeHtml(html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim());
}

main().catch((err) => {
   console.error(err);
   process.exit(1);
});
