import { Global, Injectable, Module } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { RealtimeGateway, rooms } from './realtime.gateway';

/** Relays committed domain events to the websocket rooms that care about them. */
@Injectable()
export class RealtimeRelay {
  constructor(private readonly gateway: RealtimeGateway) {}

  @OnEvent(DOMAIN_EVENT, { async: true })
  relay(e: DomainEvent) {
    const targets = new Set<string>();
    if (e.projectId) targets.add(rooms.project(e.projectId));
    if (e.type.startsWith('PROJECT_') || e.type === 'USER_ADDED') targets.add(rooms.org(e.organizationId));
    // Keep "My Work" live for the people a task belongs to, whatever project they have open.
    const task = e.data?.task;
    if (task?.assignee?.id) targets.add(rooms.user(task.assignee.id));
    if (e.type === 'TASK_ASSIGNED' && e.data.previousAssigneeId) targets.add(rooms.user(e.data.previousAssigneeId));
    const assigneeChange = e.data?.changes?.assigneeId;
    if (assigneeChange?.from) targets.add(rooms.user(assigneeChange.from as string));

    this.gateway.publish([...targets], { id: e.id, type: e.type, projectId: e.projectId, actor: e.actor, occurredAt: e.occurredAt, data: e.data });
  }
}

@Global()
@Module({ providers: [RealtimeGateway, RealtimeRelay], exports: [RealtimeGateway] })
export class RealtimeModule {}
