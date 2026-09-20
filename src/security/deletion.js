import { invariant } from '../domain/errors.js';

export function deleteWorkspace({ workspaceId, credentialVault, store }) {
  invariant(credentialVault && typeof credentialVault.revokeWorkspace === 'function', 'CREDENTIAL_VAULT_REQUIRED', 'A credential revocation adapter is required.');
  invariant(store.getWorkspace(workspaceId), 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
  credentialVault.revokeWorkspace(workspaceId);
  const purged = store.purgeWorkspace(workspaceId);
  return { workspaceId, credentialsRevoked: true, primaryDataPurged: purged === 1 };
}
