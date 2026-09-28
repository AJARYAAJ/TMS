import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column() name: string;
  @Column({ type: 'text', default: '' }) description: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @OneToMany(() => TeamMember, (m) => m.team) members: TeamMember[];
}

@Entity('team_members')
@Unique(['teamId', 'userId'])
export class TeamMember {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') teamId: string;
  @Column('uuid') userId: string;
  @ManyToOne(() => Team, (t) => t.members, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'team_id' }) team: Team;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
}
