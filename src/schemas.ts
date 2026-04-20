import { z } from 'zod';

export const BugCheckReferenceEntrySchema = z.object({
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

export const BugCheckReferenceEntriesSchema = z.array(BugCheckReferenceEntrySchema);

export const BugCheckReferenceCacheSchema = z.object({
   fetchedAt: z.number(),
   entries: BugCheckReferenceEntriesSchema,
});
