/** Verified against the installed T3 source on 2026-10-02. The public
 * orchestration commands expose runtimeMode, not per-run writable/denied paths.
 * Setting a workspace path or writing prompt instructions is NOT enforcement.
 * Keep this source-only implementation out of the live registration path. */
export const coordinatedDeliveryBlockers=Object.freeze([
  'T3 dispatch cannot enforce a per-run live-vault write exclusion. Full-access and permission escalation remain possible.',
  'Actual iPhone validation is unavailable: T3 device access is disabled in this environment.',
  'Native multi-view, controls, migration fencing and real Obsidian Sync contention acceptance are not complete.',
]);
export function assertCoordinatedDeliveryAvailable():never {
  throw Error(`Coordinated response delivery is not enabled. ${coordinatedDeliveryBlockers.join(' ')}`);
}
