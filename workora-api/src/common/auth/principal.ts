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
  /** How this session signed in: password, password + 2FA, or single sign-on. */
  amr?: SignInMethod;
  /** The workspace requires 2FA and this member hasn't set it up yet (only security routes are allowed). */
  mfaSetupRequired?: boolean;
}

export type SignInMethod = 'pwd' | 'mfa' | 'sso';

export interface JwtPayload {
  sub: string;
  org: string;
  amr?: SignInMethod;
  /** Present only on short-lived 2FA challenge tokens, which are never accepted as sessions. */
  typ?: 'mfa';
}

export interface Actor {
  id: string;
  name: string;
  /** Automation id when the change was made by a rule (prevents rule loops). */
  automation?: string;
}

export const actorOf = (p: AuthPrincipal): Actor =>
  p.automation ? { id: p.userId, name: p.name, automation: p.automation } : { id: p.userId, name: p.name };
