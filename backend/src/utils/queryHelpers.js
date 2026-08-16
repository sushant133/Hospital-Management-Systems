/**
 * Shared query-building helpers so every list endpoint paginates, sorts and
 * scopes soft deletes the same way.
 */

/**
 * Build { page, limit, skip, sort } from a validated query object.
 * `sort` accepts a comma list with `-` for descending: "-createdAt,lastName".
 */
export function buildPagination(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const sort = {};
  const sortSpec = query.sort || '-createdAt';
  for (const field of String(sortSpec).split(',')) {
    const trimmed = field.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('-')) sort[trimmed.slice(1)] = -1;
    else sort[trimmed] = 1;
  }

  return { page, limit, skip, sort };
}

/** Standard pagination meta block returned alongside list data. */
export function buildMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
    /**
     * True when this response does not contain everything that matched.
     *
     * Aimed at the callers that load a list into a picker rather than paging
     * through it. Silent truncation there is the dangerous case: a pharmacist
     * who cannot see a drug concludes it is not stocked, and nothing on screen
     * says otherwise. With this flag the picker can say "showing 500 of 812 —
     * refine your search".
     */
    truncated: page === 1 && total > limit,
  };
}

/**
 * Soft-delete scope. Non-admins never see inactive records; admins can opt in
 * with ?includeInactive=true.
 */
export function activeScope(query = {}, user = null) {
  const wantsInactive = query.includeInactive === true || query.includeInactive === 'true';
  const isAdmin = user?.role === 'admin';
  return wantsInactive && isAdmin ? {} : { isActive: true };
}

/** Escape a user-supplied string before embedding it in a RegExp. */
export function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" filter across several fields. */
export function searchFilter(term, fields = []) {
  if (!term || !fields.length) return null;
  const rx = new RegExp(escapeRegex(term), 'i');
  return { $or: fields.map((field) => ({ [field]: rx })) };
}

/** Merge filter fragments, dropping null/undefined/empty entries. */
export function andFilters(...fragments) {
  const valid = fragments.filter((f) => f && Object.keys(f).length > 0);
  if (valid.length === 0) return {};
  if (valid.length === 1) return valid[0];
  return { $and: valid };
}

/**
 * Soft-delete patch, for `Object.assign(doc, softDeletePatch(user))` and for
 * bulk `updateMany` cascades. No route ever calls deleteOne on a business
 * collection. The reverse (restore) is the `restore()` instance method added by
 * the auditable plugin.
 */
export function softDeletePatch(user) {
  return {
    isActive: false,
    deletedAt: new Date(),
    deletedBy: user?._id ?? null,
    updatedBy: user?._id ?? null,
  };
}
