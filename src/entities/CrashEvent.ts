import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'crash_events' })
@Index(['timestamp'])
@Index(['crashType'])
@Index(['applicationName'])
@Index(['bugCheckCode'])
@Index(['processName'])
export class CrashEventEntity {
   @PrimaryGeneratedColumn()
   id!: number;

   @Column({ type: 'varchar', unique: true })
   hashId!: string;

   @Column({ type: 'varchar', unique: true })
   shortId!: string;

   @Column({ type: 'integer' })
   timestamp!: number;

   @Column({ type: 'varchar' })
   crashType!: 'bsod' | 'app';

   @Column({ type: 'varchar', nullable: true })
   applicationName!: string | null;

   @Column({ type: 'varchar', nullable: true })
   bugCheckCode!: string | null;

   @Column({ type: 'varchar', nullable: true })
   bugCheckName!: string | null;

   @Column({ type: 'varchar', nullable: true })
   processName!: string | null;

   @Column({ type: 'varchar', nullable: true })
   reportId!: string | null;

   @Column({ type: 'varchar', nullable: true })
   reportStatus!: string | null;

   @Column({ type: 'text', nullable: true })
   stackTrace!: string | null;

   @Column({ type: 'simple-json', nullable: true })
   dumpPaths!: string[] | null;

   @Column({ type: 'simple-json', nullable: true })
   relatedEventLogs!: string[] | null;

   @Column({ type: 'varchar', nullable: true })
   osVersion!: string | null;

   @Column({ type: 'varchar', nullable: true })
   osBuild!: string | null;

   @Column({ type: 'varchar', nullable: true })
   driverVersion!: string | null;

   @Column({ type: 'text', nullable: true })
   rawPayload!: string | null;

   @Column({ type: 'varchar', default: 'eventlog' })
   source!: string;
}
