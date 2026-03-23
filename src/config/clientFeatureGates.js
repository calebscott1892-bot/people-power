/**
 * Client-side feature gates (hardcoded toggles for features not yet ready).
 *
 * Centralise all "is this feature currently disabled?" checks here so they
 * can be flipped in ONE place rather than scattered across multiple files.
 *
 * Once a feature is fully enabled, remove its gate from this file and all
 * consuming call-sites.
 */

/** Direct Messages — enabled. */
export const DM_DISABLED = false;

/** DM disabled toast message — single source of truth for the user-facing text. */
export const DM_DISABLED_MESSAGE =
  'Direct Messages are temporarily disabled while we upgrade messaging. Please use movement comments or profile links in the meantime.';
