export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

const RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };

/** Role hierarchy: OWNER > ADMIN > MEMBER > VIEWER. */
export function hasRole(actual: Role, required: Role) {
  return RANK[actual] >= RANK[required];
}
