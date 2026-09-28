import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('favorites')
export class Favorite {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('uuid') projectId: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
