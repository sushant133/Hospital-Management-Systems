import { useMemo } from 'react';
import { useAuth } from './useAuth.js';
import { hasAnyPermission } from '../utils/permissions.js';

/**
 * Permission checks without pulling in the rest of the session.
 *
 *   const { can, canAny } = usePermissions();
 *   {can(MODULES.PATIENTS, 'create') && <Button>New patient</Button>}
 *
 * These gate *what the UI offers*, never what the data allows — the API
 * re-checks the same matrix on every request, so a hand-crafted URL or a
 * patched bundle still gets a 403 rather than records.
 */
export function usePermissions() {
  const { permissions, can, canAccess } = useAuth();

  return useMemo(
    () => ({
      permissions,
      /** One capability: `can('patients', 'edit')`. */
      can,
      /** Any capability in the module — for showing a nav entry at all. */
      canAccess,
      /** Any one of several actions: `canAny('lab_orders', ['view', 'create'])`. */
      canAny: (module, actions) => hasAnyPermission(permissions, module, actions),
    }),
    [permissions, can, canAccess],
  );
}

export default usePermissions;
