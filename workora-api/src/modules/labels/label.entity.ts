import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('labels')
export class Label {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column() name: string;
  @Column() color: string;
  @Column({ default: '' }) description: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const toLabelDto = (l: Label) => ({ id: l.id, name: l.name, color: l.color, description: l.description ?? '' });
