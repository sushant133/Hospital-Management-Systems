import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULES,
  PERMISSION_MATRIX,
  can,
  actionsFor,
  permissionsForRole,
  rolesWith,
  assertPermissionExists,
} from '../../src/config/permissions.js';
import { ROLE_VALUES, ROLES } from '../../src/config/roles.js';

describe('permission matrix', () => {
  const modules = Object.values(MODULES);

  it('lists every MODULES value in PERMISSION_MATRIX and nothing extra', () => {
    const matrixKeys = Object.keys(PERMISSION_MATRIX).sort();
    assert.deepEqual(matrixKeys, [...modules].sort());
  });

  it('every (module, action) pair is known to assertPermissionExists', () => {
    for (const module of modules) {
      for (const action of actionsFor(module)) {
        assert.doesNotThrow(() => assertPermissionExists(module, action));
      }
    }
  });

  it('admin holds every action on every module', () => {
    for (const module of modules) {
      for (const action of actionsFor(module)) {
        assert.equal(can(ROLES.ADMIN, module, action), true, `admin missing ${module}.${action}`);
      }
    }
  });

  it('rolesWith includes admin for every pair, and matches can() for every role', () => {
    for (const module of modules) {
      for (const action of actionsFor(module)) {
        const holders = rolesWith(module, action);
        assert.ok(holders.includes(ROLES.ADMIN), `admin absent from rolesWith(${module}, ${action})`);
        for (const role of ROLE_VALUES) {
          assert.equal(
            holders.includes(role),
            can(role, module, action),
            `rolesWith/can disagree for ${role} on ${module}.${action}`,
          );
        }
      }
    }
  });

  it('permissionsForRole(admin) is the full explicit grant', () => {
    const grants = permissionsForRole(ROLES.ADMIN);
    for (const module of modules) {
      assert.deepEqual(grants[module].sort(), actionsFor(module).sort());
    }
  });

  it('permissionsForRole omits modules the role cannot touch', () => {
    const grants = permissionsForRole(ROLES.STAFF);
    assert.equal(grants.payroll === undefined || !grants.payroll.includes('view'), true);
    assert.ok(grants.attendance?.includes('recordOwn'));
  });

  it('rejects unknown modules and actions at the assertion boundary', () => {
    assert.throws(() => assertPermissionExists('no-such-module', 'view'));
    assert.throws(() => assertPermissionExists(MODULES.PATIENTS, 'teleport'));
  });
});
