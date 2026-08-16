/**
 * ============================================================================
 * NEPAL'S ADMINISTRATIVE HIERARCHY
 * ============================================================================
 *
 * Province → District → Local level → Ward. Since the 2017 restructuring there
 * are 7 provinces, 77 districts and 753 local levels; a local level is one of
 * Metropolitan City, Sub-Metropolitan City, Municipality or Rural Municipality
 * (Gaunpalika), and every one of them is divided into numbered wards.
 *
 * This is not cosmetic. HMIS returns aggregate by district, insurance catchment
 * and referral routing are palika-keyed, and "which ward does this outbreak sit
 * in" is a question the district health office will ask. A free-text city field
 * cannot answer any of it.
 *
 * ---------------------------------------------------------------------------
 * WHY PROVINCES AND DISTRICTS ARE CODE, BUT LOCAL LEVELS ARE DATA
 * ---------------------------------------------------------------------------
 * The 7 + 77 are stable, small, and safe to hold as constants — they change
 * only by constitutional amendment. The 753 local levels are a different
 * matter: they carry ward counts, they have been revised since 2017, and
 * transcribing them by hand would put typos into the one table every address,
 * report and claim keys off. So they live in a `localLevels` collection seeded
 * from the official MoFAGA list (see backend/scripts/importLocalLevels.js),
 * with the metropolitan and sub-metropolitan cities shipped inline as a
 * working baseline.
 *
 * Codes follow the national convention: province "P3", district "P3-D27",
 * local level "P3-D27-L01". They are stable strings, never array indices.
 */

import { toNepaliDigits } from './digits.js';

export const LOCAL_LEVEL_TYPES = Object.freeze({
  METROPOLITAN: 'metropolitan',
  SUB_METROPOLITAN: 'sub_metropolitan',
  MUNICIPALITY: 'municipality',
  RURAL_MUNICIPALITY: 'rural_municipality',
});

export const LOCAL_LEVEL_TYPE_VALUES = Object.freeze(Object.values(LOCAL_LEVEL_TYPES));

export const LOCAL_LEVEL_LABELS = Object.freeze({
  [LOCAL_LEVEL_TYPES.METROPOLITAN]: { en: 'Metropolitan City', ne: 'महानगरपालिका' },
  [LOCAL_LEVEL_TYPES.SUB_METROPOLITAN]: { en: 'Sub-Metropolitan City', ne: 'उपमहानगरपालिका' },
  [LOCAL_LEVEL_TYPES.MUNICIPALITY]: { en: 'Municipality', ne: 'नगरपालिका' },
  [LOCAL_LEVEL_TYPES.RURAL_MUNICIPALITY]: { en: 'Rural Municipality', ne: 'गाउँपालिका' },
});

/** The seven provinces. `code` is what gets stored on a record. */
export const PROVINCES = Object.freeze([
  { code: 'P1', number: 1, en: 'Koshi', ne: 'कोशी', headquarters: 'Biratnagar' },
  { code: 'P2', number: 2, en: 'Madhesh', ne: 'मधेश', headquarters: 'Janakpur' },
  { code: 'P3', number: 3, en: 'Bagmati', ne: 'बागमती', headquarters: 'Hetauda' },
  { code: 'P4', number: 4, en: 'Gandaki', ne: 'गण्डकी', headquarters: 'Pokhara' },
  { code: 'P5', number: 5, en: 'Lumbini', ne: 'लुम्बिनी', headquarters: 'Deukhuri' },
  { code: 'P6', number: 6, en: 'Karnali', ne: 'कर्णाली', headquarters: 'Birendranagar' },
  { code: 'P7', number: 7, en: 'Sudurpashchim', ne: 'सुदूरपश्चिम', headquarters: 'Godawari' },
]);

/**
 * All 77 districts, grouped by province.
 *
 * Note the two Nawalparasi and two Rukum halves — the 2017 restructuring split
 * each across a provincial boundary, and they are genuinely separate districts
 * now. Systems that treat "Nawalparasi" as one district misfile every patient
 * from either half.
 */
export const DISTRICTS = Object.freeze([
  // ---- Province 1: Koshi (14) ----
  { code: 'P1-D01', province: 'P1', en: 'Bhojpur', ne: 'भोजपुर' },
  { code: 'P1-D02', province: 'P1', en: 'Dhankuta', ne: 'धनकुटा' },
  { code: 'P1-D03', province: 'P1', en: 'Ilam', ne: 'इलाम' },
  { code: 'P1-D04', province: 'P1', en: 'Jhapa', ne: 'झापा' },
  { code: 'P1-D05', province: 'P1', en: 'Khotang', ne: 'खोटाङ' },
  { code: 'P1-D06', province: 'P1', en: 'Morang', ne: 'मोरङ' },
  { code: 'P1-D07', province: 'P1', en: 'Okhaldhunga', ne: 'ओखलढुंगा' },
  { code: 'P1-D08', province: 'P1', en: 'Panchthar', ne: 'पाँचथर' },
  { code: 'P1-D09', province: 'P1', en: 'Sankhuwasabha', ne: 'संखुवासभा' },
  { code: 'P1-D10', province: 'P1', en: 'Solukhumbu', ne: 'सोलुखुम्बु' },
  { code: 'P1-D11', province: 'P1', en: 'Sunsari', ne: 'सुनसरी' },
  { code: 'P1-D12', province: 'P1', en: 'Taplejung', ne: 'ताप्लेजुङ' },
  { code: 'P1-D13', province: 'P1', en: 'Terhathum', ne: 'तेह्रथुम' },
  { code: 'P1-D14', province: 'P1', en: 'Udayapur', ne: 'उदयपुर' },

  // ---- Province 2: Madhesh (8) ----
  { code: 'P2-D01', province: 'P2', en: 'Bara', ne: 'बारा' },
  { code: 'P2-D02', province: 'P2', en: 'Dhanusha', ne: 'धनुषा' },
  { code: 'P2-D03', province: 'P2', en: 'Mahottari', ne: 'महोत्तरी' },
  { code: 'P2-D04', province: 'P2', en: 'Parsa', ne: 'पर्सा' },
  { code: 'P2-D05', province: 'P2', en: 'Rautahat', ne: 'रौतहट' },
  { code: 'P2-D06', province: 'P2', en: 'Saptari', ne: 'सप्तरी' },
  { code: 'P2-D07', province: 'P2', en: 'Sarlahi', ne: 'सर्लाही' },
  { code: 'P2-D08', province: 'P2', en: 'Siraha', ne: 'सिराहा' },

  // ---- Province 3: Bagmati (13) ----
  { code: 'P3-D01', province: 'P3', en: 'Bhaktapur', ne: 'भक्तपुर' },
  { code: 'P3-D02', province: 'P3', en: 'Chitwan', ne: 'चितवन' },
  { code: 'P3-D03', province: 'P3', en: 'Dhading', ne: 'धादिङ' },
  { code: 'P3-D04', province: 'P3', en: 'Dolakha', ne: 'दोलखा' },
  { code: 'P3-D05', province: 'P3', en: 'Kathmandu', ne: 'काठमाडौं' },
  { code: 'P3-D06', province: 'P3', en: 'Kavrepalanchok', ne: 'काभ्रेपलाञ्चोक' },
  { code: 'P3-D07', province: 'P3', en: 'Lalitpur', ne: 'ललितपुर' },
  { code: 'P3-D08', province: 'P3', en: 'Makwanpur', ne: 'मकवानपुर' },
  { code: 'P3-D09', province: 'P3', en: 'Nuwakot', ne: 'नुवाकोट' },
  { code: 'P3-D10', province: 'P3', en: 'Ramechhap', ne: 'रामेछाप' },
  { code: 'P3-D11', province: 'P3', en: 'Rasuwa', ne: 'रसुवा' },
  { code: 'P3-D12', province: 'P3', en: 'Sindhuli', ne: 'सिन्धुली' },
  { code: 'P3-D13', province: 'P3', en: 'Sindhupalchok', ne: 'सिन्धुपाल्चोक' },

  // ---- Province 4: Gandaki (11) ----
  { code: 'P4-D01', province: 'P4', en: 'Baglung', ne: 'बागलुङ' },
  { code: 'P4-D02', province: 'P4', en: 'Gorkha', ne: 'गोरखा' },
  { code: 'P4-D03', province: 'P4', en: 'Kaski', ne: 'कास्की' },
  { code: 'P4-D04', province: 'P4', en: 'Lamjung', ne: 'लमजुङ' },
  { code: 'P4-D05', province: 'P4', en: 'Manang', ne: 'मनाङ' },
  { code: 'P4-D06', province: 'P4', en: 'Mustang', ne: 'मुस्ताङ' },
  { code: 'P4-D07', province: 'P4', en: 'Myagdi', ne: 'म्याग्दी' },
  { code: 'P4-D08', province: 'P4', en: 'Nawalpur', ne: 'नवलपुर' },
  { code: 'P4-D09', province: 'P4', en: 'Parbat', ne: 'पर्वत' },
  { code: 'P4-D10', province: 'P4', en: 'Syangja', ne: 'स्याङ्जा' },
  { code: 'P4-D11', province: 'P4', en: 'Tanahun', ne: 'तनहुँ' },

  // ---- Province 5: Lumbini (12) ----
  { code: 'P5-D01', province: 'P5', en: 'Arghakhanchi', ne: 'अर्घाखाँची' },
  { code: 'P5-D02', province: 'P5', en: 'Banke', ne: 'बाँके' },
  { code: 'P5-D03', province: 'P5', en: 'Bardiya', ne: 'बर्दिया' },
  { code: 'P5-D04', province: 'P5', en: 'Dang', ne: 'दाङ' },
  { code: 'P5-D05', province: 'P5', en: 'Gulmi', ne: 'गुल्मी' },
  { code: 'P5-D06', province: 'P5', en: 'Kapilvastu', ne: 'कपिलवस्तु' },
  { code: 'P5-D07', province: 'P5', en: 'Palpa', ne: 'पाल्पा' },
  { code: 'P5-D08', province: 'P5', en: 'Parasi', ne: 'परासी' },
  { code: 'P5-D09', province: 'P5', en: 'Pyuthan', ne: 'प्यूठान' },
  { code: 'P5-D10', province: 'P5', en: 'Rolpa', ne: 'रोल्पा' },
  { code: 'P5-D11', province: 'P5', en: 'Rukum East', ne: 'पूर्वी रुकुम' },
  { code: 'P5-D12', province: 'P5', en: 'Rupandehi', ne: 'रुपन्देही' },

  // ---- Province 6: Karnali (10) ----
  { code: 'P6-D01', province: 'P6', en: 'Dailekh', ne: 'दैलेख' },
  { code: 'P6-D02', province: 'P6', en: 'Dolpa', ne: 'डोल्पा' },
  { code: 'P6-D03', province: 'P6', en: 'Humla', ne: 'हुम्ला' },
  { code: 'P6-D04', province: 'P6', en: 'Jajarkot', ne: 'जाजरकोट' },
  { code: 'P6-D05', province: 'P6', en: 'Jumla', ne: 'जुम्ला' },
  { code: 'P6-D06', province: 'P6', en: 'Kalikot', ne: 'कालिकोट' },
  { code: 'P6-D07', province: 'P6', en: 'Mugu', ne: 'मुगु' },
  { code: 'P6-D08', province: 'P6', en: 'Rukum West', ne: 'पश्चिम रुकुम' },
  { code: 'P6-D09', province: 'P6', en: 'Salyan', ne: 'सल्यान' },
  { code: 'P6-D10', province: 'P6', en: 'Surkhet', ne: 'सुर्खेत' },

  // ---- Province 7: Sudurpashchim (9) ----
  { code: 'P7-D01', province: 'P7', en: 'Achham', ne: 'अछाम' },
  { code: 'P7-D02', province: 'P7', en: 'Baitadi', ne: 'बैतडी' },
  { code: 'P7-D03', province: 'P7', en: 'Bajhang', ne: 'बझाङ' },
  { code: 'P7-D04', province: 'P7', en: 'Bajura', ne: 'बाजुरा' },
  { code: 'P7-D05', province: 'P7', en: 'Dadeldhura', ne: 'डडेल्धुरा' },
  { code: 'P7-D06', province: 'P7', en: 'Darchula', ne: 'दार्चुला' },
  { code: 'P7-D07', province: 'P7', en: 'Doti', ne: 'डोटी' },
  { code: 'P7-D08', province: 'P7', en: 'Kailali', ne: 'कैलाली' },
  { code: 'P7-D09', province: 'P7', en: 'Kanchanpur', ne: 'कञ्चनपुर' },
]);

/**
 * The 6 metropolitan and 11 sub-metropolitan cities, shipped inline so a fresh
 * install can register urban patients before anyone runs the full import.
 * The remaining ~736 municipalities and rural municipalities come from the
 * MoFAGA dataset via `importLocalLevels.js`.
 */
export const MAJOR_LOCAL_LEVELS = Object.freeze([
  // Metropolitan cities (6)
  { code: 'P3-D05-L01', district: 'P3-D05', type: LOCAL_LEVEL_TYPES.METROPOLITAN, en: 'Kathmandu', ne: 'काठमाडौं', wards: 32 },
  { code: 'P3-D07-L01', district: 'P3-D07', type: LOCAL_LEVEL_TYPES.METROPOLITAN, en: 'Lalitpur', ne: 'ललितपुर', wards: 29 },
  { code: 'P4-D03-L01', district: 'P4-D03', type: LOCAL_LEVEL_TYPES.METROPOLITAN, en: 'Pokhara', ne: 'पोखरा', wards: 33 },
  { code: 'P1-D06-L01', district: 'P1-D06', type: LOCAL_LEVEL_TYPES.METROPOLITAN, en: 'Biratnagar', ne: 'विराटनगर', wards: 19 },
  { code: 'P2-D04-L01', district: 'P2-D04', type: LOCAL_LEVEL_TYPES.METROPOLITAN, en: 'Birgunj', ne: 'वीरगंज', wards: 32 },
  { code: 'P5-D02-L01', district: 'P5-D02', type: LOCAL_LEVEL_TYPES.METROPOLITAN, en: 'Nepalgunj', ne: 'नेपालगंज', wards: 23 },

  // Sub-metropolitan cities (11)
  { code: 'P3-D08-L01', district: 'P3-D08', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Hetauda', ne: 'हेटौंडा', wards: 19 },
  { code: 'P3-D02-L01', district: 'P3-D02', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Bharatpur', ne: 'भरतपुर', wards: 29 },
  { code: 'P2-D02-L01', district: 'P2-D02', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Janakpurdham', ne: 'जनकपुरधाम', wards: 25 },
  { code: 'P1-D11-L01', district: 'P1-D11', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Dharan', ne: 'धरान', wards: 20 },
  { code: 'P1-D11-L02', district: 'P1-D11', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Itahari', ne: 'इटहरी', wards: 20 },
  { code: 'P5-D12-L01', district: 'P5-D12', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Butwal', ne: 'बुटवल', wards: 19 },
  { code: 'P5-D04-L01', district: 'P5-D04', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Ghorahi', ne: 'घोराही', wards: 19 },
  { code: 'P5-D04-L02', district: 'P5-D04', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Tulsipur', ne: 'तुल्सीपुर', wards: 19 },
  { code: 'P6-D10-L01', district: 'P6-D10', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Birendranagar', ne: 'वीरेन्द्रनगर', wards: 16 },
  { code: 'P7-D08-L01', district: 'P7-D08', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Dhangadhi', ne: 'धनगढी', wards: 19 },
  { code: 'P1-D04-L01', district: 'P1-D04', type: LOCAL_LEVEL_TYPES.SUB_METROPOLITAN, en: 'Damak', ne: 'दमक', wards: 10 },
]);

/* ---------------------------------------------------------------------------
 * Lookups. Built once — an address form re-renders on every keystroke.
 * ------------------------------------------------------------------------ */

const PROVINCE_BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));
const DISTRICT_BY_CODE = new Map(DISTRICTS.map((d) => [d.code, d]));

const DISTRICTS_BY_PROVINCE = (() => {
  const map = new Map();
  for (const district of DISTRICTS) {
    if (!map.has(district.province)) map.set(district.province, []);
    map.get(district.province).push(district);
  }
  return map;
})();

export function getProvince(code) {
  return PROVINCE_BY_CODE.get(code) || null;
}

export function getDistrict(code) {
  return DISTRICT_BY_CODE.get(code) || null;
}

/** Districts of one province, already in the order a select should show them. */
export function districtsOfProvince(provinceCode) {
  return DISTRICTS_BY_PROVINCE.get(provinceCode) || [];
}

/** The province a district belongs to — used to backfill an address. */
export function provinceOfDistrict(districtCode) {
  const district = getDistrict(districtCode);
  return district ? getProvince(district.province) : null;
}

export const PROVINCE_CODES = Object.freeze(PROVINCES.map((p) => p.code));
export const DISTRICT_CODES = Object.freeze(DISTRICTS.map((d) => d.code));

/** A local-level code always carries its district as a prefix. */
export function districtOfLocalLevelCode(localLevelCode) {
  const match = String(localLevelCode || '').match(/^(P\d-D\d{2})-L\d{2,3}$/);
  return match ? getDistrict(match[1]) : null;
}

/**
 * Render an address the way a Nepali envelope reads: most specific first,
 * ending at the district. Province is omitted — nobody writes it on an address
 * within Nepal, and including it makes the line unreadably long on a bill.
 */
export function formatAddress(address, { locale = 'ne', includeProvince = false } = {}) {
  if (!address) return '';
  const ne = locale === 'ne';
  const pick = (obj) => (obj ? (ne ? obj.ne : obj.en) : '');

  const district = getDistrict(address.districtCode);
  const province = district ? getProvince(district.province) : null;
  const localLevel = address.localLevelName || '';
  const wardNo = ne ? toNepaliDigits(address.wardNo) : address.wardNo;
  const wardLabel = address.wardNo ? `${ne ? 'वडा नं.' : 'Ward'} ${wardNo}` : '';

  const parts = [
    address.tole,
    localLevel,
    wardLabel,
    pick(district),
    includeProvince ? pick(province) : '',
  ].filter(Boolean);

  return parts.join(', ');
}

/** Ward numbers start at 1; no local level in Nepal exceeds 35 wards. */
export const MAX_WARD_NO = 35;

export function isValidWardNo(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_WARD_NO;
}

export default {
  PROVINCES,
  DISTRICTS,
  MAJOR_LOCAL_LEVELS,
  LOCAL_LEVEL_TYPES,
  LOCAL_LEVEL_TYPE_VALUES,
  LOCAL_LEVEL_LABELS,
  PROVINCE_CODES,
  DISTRICT_CODES,
  getProvince,
  getDistrict,
  districtsOfProvince,
  provinceOfDistrict,
  districtOfLocalLevelCode,
  formatAddress,
  isValidWardNo,
  MAX_WARD_NO,
};
