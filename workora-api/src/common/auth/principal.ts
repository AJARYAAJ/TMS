import { Role } from './roles';

/** The authenticated user within the organization (tenant) selected by their token. */
export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
  /** Set when the action is performed by the automation engine on the user's behalf. */
  automation?: string;
}

export interface JwtPayload {
  sub: string;
  org: string;
}

export interface Actor {
  id: string;
  name: string;
  /** Automation id when the change was made by a rule (prevents rule loops). */
  automation?: string;
}

export const actorOf = (p: AuthPrincipal): Actor =>
  p.automation ? { id: p.userId, name: p.name, automation: p.automation } : { id: p.userId, name: p.name };
