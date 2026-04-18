import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { getCacheDir } from '@/modules/env';
import { normalizeBugCheckCode, normalizeBugCheckName } from '@/modules/hash';
import { BugCheckReferenceEntry } from '@/types';

const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_FILE = path.resolve(process.cwd(), 'resources', 'bugcheck-reference.json');
const REMOTE_URL =
   process.env.YABSOD_BUGCHECK_REFERENCE_URL ||
   'https://raw.githubusercontent.com/Type-Delta/yabsod/main/resources/bugcheck-reference.json';

const EntrySchema = z.object({
   codeHex: z.string(),
   codeDec: z.number().optional(),
   name: z.string(),
   description: z.string(),
   possibleCauses: z.array(z.string()).optional(),
   infrequent: z.boolean().optional(),
   sourceUrl: z.string().optional(),
});

const CacheSchema = z.object({
   fetchedAt: z.number(),
   entries: z.array(EntrySchema),
});

const cacheFilePath = () => path.join(getCacheDir(), 'bugcheck-reference.cache.json');

export async function getBugCheckReference(): Promise<BugCheckReferenceEntry[]> {
   const cached = await readCache();
   if (cached && Date.now() - cached.fetchedAt <= CACHE_MAX_AGE_MS) {
      return cached.entries;
   }

   const remote = await fetchRemoteReference();
   if (remote) {
      await writeCache(remote);
      return remote;
   }

   const local = await readLocalReference();
   await writeCache(local);
   return local;
}

export async function getBugcheckInfo(input: {
   code?: string | null;
   name?: string | null;
}): Promise<BugCheckReferenceEntry | null> {
   const entries = await getBugCheckReference();
   const normalizedCode = normalizeBugCheckCode(input.code);
   const normalizedName = normalizeBugCheckName(input.name);

   const byCode = normalizedCode
      ? entries.find((item) => normalizeBugCheckCode(item.codeHex) === normalizedCode)
      : null;
   if (byCode) return byCode;

   if (normalizedName) {
      const byName = entries.find((item) => normalizeBugCheckName(item.name) === normalizedName);
      if (byName) return byName;
   }

   return null;
}

async function readCache(): Promise<{
   fetchedAt: number;
   entries: BugCheckReferenceEntry[];
} | null> {
   try {
      const content = await fs.readFile(cacheFilePath(), 'utf8');
      const parsed = JSON.parse(content);
      const validated = CacheSchema.safeParse(parsed);
      if (!validated.success) return null;
      return validated.data;
   } catch {
      return null;
   }
}

async function writeCache(entries: BugCheckReferenceEntry[]): Promise<void> {
   const body = {
      fetchedAt: Date.now(),
      entries,
   };

   await fs.writeFile(cacheFilePath(), JSON.stringify(body, null, 2), 'utf8');
}

async function fetchRemoteReference(): Promise<BugCheckReferenceEntry[] | null> {
   try {
      const response = await fetch(REMOTE_URL, {
         method: 'GET',
         headers: {
            'user-agent': 'yabsod/0.0.1',
         },
      });

      if (!response.ok) return null;
      const data = await response.json();
      const parsed = z.array(EntrySchema).safeParse(data);
      if (!parsed.success) return null;
      return parsed.data;
   } catch {
      return null;
   }
}

async function readLocalReference(): Promise<BugCheckReferenceEntry[]> {
   try {
      const content = await fs.readFile(LOCAL_FILE, 'utf8');
      const data = JSON.parse(content);
      const parsed = z.array(EntrySchema).safeParse(data);
      if (parsed.success) return parsed.data;
   } catch {
      // fallback below
   }

   return [];
}
