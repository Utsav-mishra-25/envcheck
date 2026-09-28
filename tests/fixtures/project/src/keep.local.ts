// Matches *.local.ts in .gitignore but is re-included by !keep.local.ts, so it IS scanned.
export const kept = process.env.KEPT_BY_NEGATION;
