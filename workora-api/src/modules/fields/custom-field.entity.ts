import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum FieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  SELECT = 'SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  DATE = 'DATE',
  CHECKBOX = 'CHECKBOX',
  URL = 'URL',
  PERSON = 'PERSON',
}

export interface FieldOption {
  id: string;
  label: string;
  color: string;
}

/** A project-level custom field. Task values live in `tasks.custom_values[fieldId]`. */
@Entity('custom_fields')
export class CustomField {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') projectId: string;
  @Column() name: string;
  @Column({ type: 'varchar' }) type: FieldType;
  /** Choices for SELECT / MULTI_SELECT. */
  @Column({ type: 'jsonb', default: [] }) options: FieldOption[];
  @Column({ type: 'int', default: 0 }) position: number;
  /** Required on intake forms and CSV imports. */
  @Column({ default: false }) required: boolean;
  /** Shown as a column in the List view by default. */
  @Column({ default: true }) showInList: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const toFieldDto = (f: CustomField) => ({
  id: f.id,
  projectId: f.projectId,
  name: f.name,
  type: f.type,
  options: f.options,
  position: f.position,
  required: f.required,
  showInList: f.showInList,
});
export type FieldDto = ReturnType<typeof toFieldDto>;
