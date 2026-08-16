import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse from '../utils/sendResponse.js';
import ApiError from '../utils/ApiError.js';
import { getQuery } from '../middleware/validateRequest.js';
import {
  PROVINCES,
  DISTRICTS,
  districtsOfProvince,
  LOCAL_LEVEL_LABELS,
  ID_TYPE_LABELS,
  DISABILITY_CATEGORY_LABELS,
  adToBs,
  bsToAd,
  todayBs,
  formatBs,
  formatBsIso,
  parseBsString,
  fiscalYearOf,
  fiscalYearFromStart,
  daysInBsMonth,
  BS_MONTHS_EN,
  BS_MONTHS_NE,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
} from '../utils/nepal.js';

/**
 * ============================================================================
 * NEPAL REFERENCE DATA
 * ============================================================================
 *
 * Administrative geography, identity document types, and calendar conversion.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SERVER SERVES THIS AT ALL
 * ---------------------------------------------------------------------------
 * Provinces and districts are also bundled in the client. These routes exist
 * for local-level lookups (loaded into Mongo) and for calendar conversion so
 * imports and reports use one source of truth.
 */

/**
 * The local-level collection is defined by the import script, which owns its
 * schema. Referencing the registered model rather than redefining it keeps one
 * definition; if the import has never run, the collection is simply empty and
 * the endpoint says so.
 */
function localLevelModel() {
  return mongoose.models.LocalLevel || null;
}

/** Provinces and districts — the part that never changes without an amendment. */
export const getAdministrativeDivisions = asyncHandler(async (_req, res) =>
  sendResponse(res, {
    data: {
      provinces: PROVINCES,
      districts: DISTRICTS,
      localLevelTypes: LOCAL_LEVEL_LABELS,
    },
  }),
);

export const getDistrictsForProvince = asyncHandler(async (req, res) => {
  const districts = districtsOfProvince(req.params.provinceCode);
  if (districts.length === 0) throw ApiError.notFound('No such province');
  return sendResponse(res, { data: districts });
});

/**
 * Local levels within a district.
 *
 * An empty result is a real, actionable state — it means the MoFAGA dataset has
 * not been imported — so it is reported explicitly rather than as a bare empty
 * array the UI would render as "no municipalities exist in this district".
 */
export const getLocalLevels = asyncHandler(async (req, res) => {
  const { district } = getQuery(req);
  const LocalLevel = localLevelModel();

  if (!LocalLevel) {
    return sendResponse(res, {
      data: [],
      meta: {
        imported: false,
        hint: 'Run: node scripts/importLocalLevels.js <mofaga-export.csv>',
      },
    });
  }

  const rows = await LocalLevel.find({ districtCode: district, isActive: true })
    .sort({ en: 1 })
    .lean();

  return sendResponse(res, {
    data: rows,
    meta: {
      imported: rows.length > 0,
      hint:
        rows.length === 0
          ? 'No local levels imported for this district yet. Run scripts/importLocalLevels.js.'
          : undefined,
    },
  });
});

/** Identity document types and disability categories, for form dropdowns. */
export const getIdentifierTypes = asyncHandler(async (_req, res) =>
  sendResponse(res, {
    data: {
      types: ID_TYPE_LABELS,
      disabilityCategories: DISABILITY_CATEGORY_LABELS,
    },
  }),
);

/**
 * Convert between calendars.
 *
 * `?ad=2024-07-16` → the BS date; `?bs=2081-04-01` → the Gregorian date. One
 * authoritative answer for imports, integrations and anything server-side that
 * needs a date translated.
 */
export const convertDate = asyncHandler(async (req, res) => {
  const { ad, bs } = getQuery(req);

  if (ad) {
    const parsed = new Date(ad);
    if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest('Not a valid Gregorian date');
    const converted = adToBs(parsed);
    return sendResponse(res, {
      data: {
        ad: parsed.toISOString(),
        bs: converted,
        bsIso: formatBsIso(converted),
        formatted: {
          ne: formatBs(converted, { locale: 'ne', withWeekday: true }),
          en: formatBs(converted, { locale: 'en', withWeekday: true }),
        },
      },
    });
  }

  const parts = parseBsString(bs);
  if (!parts) {
    throw ApiError.badRequest(
      'Not a valid BS date. Use yyyy-mm-dd, and check the day exists in that month.',
    );
  }
  const gregorian = bsToAd(parts.year, parts.month, parts.day);
  return sendResponse(res, {
    data: {
      bs: parts,
      bsIso: formatBsIso(parts),
      ad: gregorian.toISOString(),
      formatted: {
        ne: formatBs(parts, { locale: 'ne', withWeekday: true }),
        en: formatBs(parts, { locale: 'en', withWeekday: true }),
      },
    },
  });
});

/**
 * Today, the current fiscal year, and the month lengths a picker needs.
 *
 * Served rather than computed client-side so that "today" is the hospital
 * server's day. A ward PC with a wrong clock would otherwise open an encounter
 * dated yesterday, and nobody would notice until the monthly return was short.
 */
export const getCalendarContext = asyncHandler(async (_req, res) => {
  const today = todayBs();
  const fy = fiscalYearOf();

  return sendResponse(res, {
    data: {
      today,
      todayIso: formatBsIso(today),
      todayFormatted: {
        ne: formatBs(today, { locale: 'ne', withWeekday: true }),
        en: formatBs(today, { locale: 'en', withWeekday: true }),
      },
      fiscalYear: fy,
      months: BS_MONTHS_EN.map((en, index) => ({
        month: index + 1,
        en,
        ne: BS_MONTHS_NE[index],
        days: daysInBsMonth(today.year, index + 1),
      })),
      range: { min: MIN_BS_YEAR, max: MAX_BS_YEAR },
    },
  });
});

/** The last N fiscal years, for a report period selector. */
export const getFiscalYears = asyncHandler(async (_req, res) => {
  const current = fiscalYearOf();
  const years = [];
  for (let offset = 0; offset < 8; offset += 1) {
    years.push(fiscalYearFromStart(current.startYear - offset));
  }
  return sendResponse(res, { data: years, meta: { current: current.code } });
});
