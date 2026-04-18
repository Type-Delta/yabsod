import 'reflect-metadata';

import { DataSource, Repository } from 'typeorm';

import { AchievementEntity } from '@/entities/Achievement';
import { CrashEventEntity } from '@/entities/CrashEvent';
import { getDatabasePath } from '@/modules/env';

let source: DataSource | null = null;

export async function getDataSource(): Promise<DataSource> {
   if (source?.isInitialized) return source;

   source = new DataSource({
      type: 'sqlite',
      database: getDatabasePath(),
      entities: [CrashEventEntity, AchievementEntity],
      synchronize: true,
      logging: false,
   });

   await source.initialize();
   return source;
}

export async function crashRepo(): Promise<Repository<CrashEventEntity>> {
   const ds = await getDataSource();
   return ds.getRepository(CrashEventEntity);
}

export async function achievementRepo(): Promise<Repository<AchievementEntity>> {
   const ds = await getDataSource();
   return ds.getRepository(AchievementEntity);
}

export async function closeDataSource(): Promise<void> {
   if (source?.isInitialized) {
      await source.destroy();
   }
   source = null;
}
