import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { AuthPrincipal } from '../../common/auth/principal';
import { TokenService } from '../../common/auth/token.service';
import { isUuid } from '../../common/http/identifiers';
import { Project } from '../projects/project.entity';

export interface RealtimeMessage {
  id: string;
  type: string;
  projectId?: string;
  actor: { id: string; name: string } | null;
  occurredAt: string;
  data: unknown;
}

export const rooms = {
  org: (id: string) => `org:${id}`,
  user: (id: string) => `user:${id}`,
  project: (id: string) => `project:${id}`,
};

/**
 * Realtime gateway (socket.io). Clients authenticate with their JWT in the handshake,
 * are auto-joined to `org:<id>` and `user:<id>`, and subscribe to `project:<id>` rooms
 * for the project they are looking at.
 */
@WebSocketGateway({ path: '/api/v1/realtime', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly dataSource: DataSource,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token ?? client.handshake.query?.token;
    const principal = await this.tokens.authenticate(typeof token === 'string' ? token : undefined);
    if (!principal) {
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required' });
      client.disconnect(true);
      return;
    }
    client.data.principal = principal;
    await client.join([rooms.org(principal.organizationId), rooms.user(principal.userId)]);
    client.emit('ready', { userId: principal.userId, organizationId: principal.organizationId });
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { projectId?: string }) {
    const principal: AuthPrincipal | undefined = client.data.principal;
    if (!principal || !isUuid(body?.projectId)) return { ok: false, error: 'INVALID_PROJECT' };
    const allowed = await this.dataSource.getRepository(Project).existsBy({ id: body.projectId!, organizationId: principal.organizationId });
    if (!allowed) return { ok: false, error: 'PROJECT_NOT_FOUND' };
    await client.join(rooms.project(body.projectId!));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { projectId?: string }) {
    if (isUuid(body?.projectId)) await client.leave(rooms.project(body.projectId!));
    return { ok: true };
  }

  publish(targets: string[], message: RealtimeMessage) {
    if (!this.server || !targets.length) return;
    this.server.to(targets).emit('event', message);
  }
}
