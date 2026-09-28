import { Role } from './roles';

/** The authenticated user within the organization (tenant) selected by their token. */
export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
}

export interface JwtPayload {
  sub: string;
  org: string;
}

export interface Actor {
  id: string;
  name: string;
}

export const actorOf = (p: AuthPrincipal): Actor => ({ id: p.userId, name: p.name });
