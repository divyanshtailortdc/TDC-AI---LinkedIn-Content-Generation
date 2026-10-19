/**
 * Roles stored in auth_users.role by Better Auth's Admin plugin. New users get
 * USER_ROLE; nobody can choose their own role (the plugin marks the field as
 * not user-settable), so ADMIN_ROLE is only ever granted by an existing admin
 * or a reviewed database update (docs/AUTHENTICATION.md).
 */
export const USER_ROLE = 'user'
export const ADMIN_ROLE = 'admin'

/** Roles that count as admin, as configured on the Admin plugin. */
export const ADMIN_ROLES = [ADMIN_ROLE]

/** Parses ADMIN_USER_IDS ("id1, id2") into the plugin's `adminUserIds`. */
export function parseAdminUserIds(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
}

/**
 * The same rule the Admin plugin applies: a user is an admin when their id is
 * in `adminUserIds`, or any of their comma-separated roles is an admin role.
 */
export function isAdminUser(
  user: { id: string; role?: string | null },
  adminUserIds: readonly string[] = []
): boolean {
  if (adminUserIds.includes(user.id)) return true
  const roles = (user.role ?? '').split(',').map(role => role.trim())
  return roles.some(role => ADMIN_ROLES.includes(role))
}
