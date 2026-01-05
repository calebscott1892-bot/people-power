// Soft-signal trust markers (not official verification).
//
// Early member requires a cutoff date. Configure via env:
// - VITE_EARLY_MEMBER_CUTOFF_ISO=2025-12-31T23:59:59.999Z
// If unset, "Early Member" will not display.

export const EARLY_MEMBER_CUTOFF_ISO = (import.meta?.env?.VITE_EARLY_MEMBER_CUTOFF_ISO || '').trim() || null;
