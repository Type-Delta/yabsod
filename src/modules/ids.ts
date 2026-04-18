import { Repository } from 'typeorm';

import { CrashEventEntity } from '@/entities/CrashEvent';

export async function toShortHashId(
   hashId: string,
   repo: Repository<CrashEventEntity>,
   minLen = 4
): Promise<string> {
   let len = Math.max(4, minLen);

   while (len <= hashId.length) {
      const shortId = hashId.slice(0, len);
      const found = await repo.findOne({ where: { shortId } });
      if (!found || found.hashId === hashId) {
         return shortId;
      }

      len += 1;
   }

   return hashId;
}
