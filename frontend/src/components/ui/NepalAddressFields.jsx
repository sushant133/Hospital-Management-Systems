import { useEffect, useMemo, useState } from 'react';
import {
  PROVINCES,
  districtsOfProvince,
  getDistrict,
  MAX_WARD_NO,
  toNepaliDigits,
} from '../../utils/nepal.js';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { Field, Input, Select } from './Field.jsx';

/**
 * ============================================================================
 * NEPAL ADDRESS FIELDS
 * ============================================================================
 *
 * Province → District → Local level → Ward → Tole.
 *
 * Codes are stored, not names. Every statutory return, insurance catchment and
 * referral pathway aggregates by district and palika, and free text cannot be
 * grouped — "Kathmandu", "KTM", "काठमाडौं" and "Kathmandu Metro" are one place
 * to a human and four to a GROUP BY.
 *
 * The local level is stored as a code *and* a name snapshot: the code so
 * reports aggregate, the name so a bill printed today still reads correctly
 * after a palika is renamed or merged.
 */
export default function NepalAddressFields({
  value = {},
  onChange,
  disabled = false,
  required = false,
  /** Local levels for the selected district, fetched by the parent. */
  localLevels = [],
  onDistrictChange,
  errors = {},
}) {
  const { t, isNepali } = useI18n();
  const pick = (row) => (isNepali ? row.ne : row.en);
  const digits = (n) => (isNepali ? toNepaliDigits(n) : String(n));

  const [province, setProvince] = useState(value.provinceCode || '');

  // Backfill the province when only a district is known — an imported record,
  // or a patient loaded from an older row.
  useEffect(() => {
    if (!value.provinceCode && value.districtCode) {
      const district = getDistrict(value.districtCode);
      if (district) setProvince(district.province);
    } else if (value.provinceCode !== province) {
      setProvince(value.provinceCode || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.provinceCode, value.districtCode]);

  const districts = useMemo(() => districtsOfProvince(province), [province]);

  const update = (patch) => onChange?.({ ...value, ...patch });

  const handleProvince = (code) => {
    setProvince(code);
    // Changing province invalidates everything below it. Silently keeping a
    // Kaski municipality under Bagmati is worse than making the user re-pick.
    update({
      provinceCode: code,
      districtCode: '',
      localLevelCode: '',
      localLevelName: '',
      wardNo: null,
    });
  };

  const handleDistrict = (code) => {
    update({ districtCode: code, localLevelCode: '', localLevelName: '', wardNo: null });
    onDistrictChange?.(code);
  };

  const handleLocalLevel = (code) => {
    const level = localLevels.find((l) => l.code === code);
    update({
      localLevelCode: code,
      // Snapshot the name at the spelling in force today.
      localLevelName: level ? pick(level) : '',
      wardNo: null,
    });
  };

  const selectedLevel = localLevels.find((l) => l.code === value.localLevelCode);
  const wardCount = selectedLevel?.wards || MAX_WARD_NO;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('address.province')} required={required} error={errors.provinceCode}>
        <Select
          value={province}
          onChange={(e) => handleProvince(e.target.value)}
          disabled={disabled}
        >
          <option value="">—</option>
          {PROVINCES.map((p) => (
            <option key={p.code} value={p.code}>
              {pick(p)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('address.district')} required={required} error={errors.districtCode}>
        <Select
          value={value.districtCode || ''}
          onChange={(e) => handleDistrict(e.target.value)}
          disabled={disabled || !province}
        >
          <option value="">—</option>
          {districts.map((d) => (
            <option key={d.code} value={d.code}>
              {pick(d)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('address.localLevel')} error={errors.localLevelCode}>
        <Select
          value={value.localLevelCode || ''}
          onChange={(e) => handleLocalLevel(e.target.value)}
          disabled={disabled || !value.districtCode}
        >
          <option value="">—</option>
          {localLevels.map((l) => (
            <option key={l.code} value={l.code}>
              {pick(l)}
            </option>
          ))}
        </Select>
        {value.districtCode && localLevels.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            {isNepali
              ? 'यस जिल्लाको स्थानीय तह सूची लोड गरिएको छैन।'
              : 'Local levels for this district have not been imported yet.'}
          </p>
        )}
      </Field>

      <Field label={t('address.ward')} error={errors.wardNo}>
        <Select
          value={value.wardNo ?? ''}
          onChange={(e) => update({ wardNo: e.target.value ? Number(e.target.value) : null })}
          disabled={disabled || !value.localLevelCode}
        >
          <option value="">—</option>
          {Array.from({ length: wardCount }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {digits(n)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="sm:col-span-2">
        <Field label={t('address.tole')} error={errors.tole}>
          <Input
            value={value.tole || ''}
            onChange={(e) => update({ tole: e.target.value })}
            disabled={disabled}
            placeholder={isNepali ? 'टोल / मार्ग / घर नं.' : 'Tole / street / house no.'}
          />
        </Field>
      </div>
    </div>
  );
}
