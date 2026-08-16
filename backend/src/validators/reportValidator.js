import { z } from 'zod';
import { optionalDate } from '../utils/commonSchemas.js';

/**
 * Every report takes the same range, so it is defined once here.
 *
 * `format` is a modifier rather than a separate route: the same report, the same
 * permission, the same numbers — only the encoding differs. The controller
 * checks `reports.export` before honouring `csv`.
 */
const rangeShape = {
  from: optionalDate,
  to: optionalDate,
  format: z.enum(['json', 'csv']).optional().default('json'),
};

export const rangeQuery = z.object(rangeShape);

export const revenueQuery = z.object({
  ...rangeShape,
  /** Series granularity only — the departmental and payer cuts are always returned. */
  groupBy: z.enum(['day', 'month']).optional().default('day'),
});

export const inventoryReportQuery = z.object({
  ...rangeShape,
  /** How far ahead to look for stock about to expire. */
  expiryDays: z.coerce.number().int().min(1).max(365).optional().default(90),
});
