import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Role } from '../../common/auth/roles';
import { User } from '../users/user.entity';
import { Organization } from './organization.entity';

@Entity('memberships')
@Unique(['organizationId', 'userId'])
export class Membership {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') userId: string;
  @Column({ type: 'varchar' }) role: Role;
  /** Hours a member can take on per week (Workload view), in minutes. */
  @Column({ type: 'int', default: 2400 }) weeklyCapacityMinutes: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization: Organization;
}
