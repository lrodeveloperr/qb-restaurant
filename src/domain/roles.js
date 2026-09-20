import { invariant } from './errors.js';

export const Role = Object.freeze({ OWNER: 'OWNER', MEMBER: 'MEMBER' });

const permissions = Object.freeze({
  OWNER: new Set(['read', 'preview', 'post', 'correct', 'manage_mapping', 'manage_billing', 'manage_members', 'delete_workspace']),
  MEMBER: new Set(['read', 'preview', 'post', 'correct', 'manage_mapping']),
});

export function can(role, action) {
  return permissions[role]?.has(action) ?? false;
}

export function authorize(role, action) {
  invariant(can(role, action), 'FORBIDDEN', `Role ${role} cannot perform ${action}.`, { role, action });
}

export function assertOwnerRemovalAllowed({ ownerCount, removingRole }) {
  invariant(!(removingRole === Role.OWNER && ownerCount <= 1), 'LAST_OWNER', 'The last workspace owner cannot leave.');
}
