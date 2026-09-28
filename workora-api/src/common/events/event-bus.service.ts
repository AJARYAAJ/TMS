import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Actor } from '../auth/principal';
import { DOMAIN_EVENT, DomainEvent, DomainEventType } from './domain-events';

@Injectable()
export class EventBus {
  constructor(private readonly emitter: EventEmitter2) {}

  /** Call only after the surrounding transaction has committed. */
  publish<T>(type: DomainEventType, e: { organizationId: string; projectId?: string; actor: Actor | null; data: T }) {
    const event: DomainEvent<T> = { id: randomUUID(), type, occurredAt: new Date().toISOString(), ...e };
    this.emitter.emit(DOMAIN_EVENT, event);
    return event;
  }
}
