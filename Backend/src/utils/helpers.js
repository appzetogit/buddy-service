export const PAGINATION_DEFAULTS = {
    defaultPage: 1,
    defaultLimit: 30,
    maxLimit: 1000,
};

export const buildPaginationOptions = (query, options = {}) => {
    const maxLimit = Number(options.maxLimit) > 0 ? Number(options.maxLimit) : 100;
    const defaultLimit = Number(options.defaultLimit) > 0 ? Number(options.defaultLimit) : 20;
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
    const skip = (page - 1) * limit;

    return { page, limit, skip };
};

/**
 * Canonical pagination metadata for list endpoints.
 * @returns {{ page: number, limit: number, total: number, totalPages: number, hasNextPage: boolean, hasPreviousPage: boolean }}
 */
export const buildPaginationMeta = ({ page = 1, limit = 20, total = 0 } = {}) => {
    const safeLimit = Math.max(1, Number(limit) || 20);
    const safeTotal = Math.max(0, Number(total) || 0);
    const totalPages =
        safeTotal > 0 ? Math.max(1, Math.ceil(safeTotal / safeLimit)) : 0;
    const safePage =
        totalPages > 0
            ? Math.min(Math.max(1, Number(page) || 1), totalPages)
            : 1;

    return {
        page: safePage,
        limit: safeLimit,
        total: safeTotal,
        totalPages,
        hasNextPage: totalPages > 0 && safePage < totalPages,
        hasPreviousPage: safePage > 1,
    };
};

export const buildPaginatedResult = ({ docs, total, page, limit }) => {
    const pagination = buildPaginationMeta({ page, limit, total });

    return {
        data: docs,
        pagination,
        /** @deprecated Use `pagination` — kept for existing API clients */
        meta: {
            total: pagination.total,
            page: pagination.page,
            limit: pagination.limit,
            totalPages: pagination.totalPages,
            hasNextPage: pagination.hasNextPage,
            hasPreviousPage: pagination.hasPreviousPage,
        },
    };
};
