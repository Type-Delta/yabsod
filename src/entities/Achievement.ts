import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'achievements' })
@Index(['key'])
@Index(['updatedAt'])
export class AchievementEntity {
   @PrimaryGeneratedColumn()
   id!: number;

   @Column({ type: 'varchar', unique: true })
   key!: string;

   @Column({ type: 'integer' })
   tier!: number;

   @Column({ type: 'varchar' })
   name!: string;

   @Column({ type: 'text' })
   description!: string;

   @Column({ type: 'text' })
   icon!: string;

   @Column({ type: 'integer' })
   unlockedAt!: number;

   @Column({ type: 'integer' })
   updatedAt!: number;

   @Column({ type: 'boolean', default: false })
   viewed!: boolean;

   @Column({ type: 'varchar', nullable: true })
   afterCompletion!: string | null;
}
