/** Coordinated guarantees apply to plugin commands and journaled staging.
 * Arbitrary privileged tools bypass this protocol; no sandbox is claimed. */
export const coordinatedDeliveryLimitations=Object.freeze([
  'Direct out-of-band agent or filesystem edits are outside the staged commit guarantee.',
  'Actual iPhone and multi-device real Sync contention were not validated for this release.',
]);
