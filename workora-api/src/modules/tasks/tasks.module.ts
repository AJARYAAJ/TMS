import { Module } from '@nestjs/common';
import { TasksController, TrashController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({ controllers: [TasksController, TrashController], providers: [TasksService], exports: [TasksService] })
export class TasksModule {}
