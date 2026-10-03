import {
  CLINICAL_UNIT_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  POSITION_OPTIONS,
  PRIMARY_SPECIALTY_OPTIONS,
  SHIFT_PREFERENCE_OPTIONS,
  computeStepCompletion,
  defaultEmploymentReference,
  defaultFormData,
  displayDateToIso,
  finalizeEmploymentApplication,
  formatOptionValues,
  formatPrimarySpecialty,
  isValidIsoDate,
  isoDateToDisplay,
  maskDisplayDateInput,
  normalizeEmploymentApplication,
  validateDirectDeposit,
  validateEmploymentApplication,
  validateEmploymentReference,
  type EmploymentApplicationData,
  type EmploymentReference,
} from '@pcs/shared';

// UAT feedback — the shared (@pcs/shared) rules every client and the Worker
// enforce, tested directly rather than only through a screen hook.

const VALID: EmploymentApplicationData = {
  ...defaultFormData.employmentApplication,
  positionApplied: 'RN', specialtyPreference: ['icu'], shiftPreference: ['am'], employmentType: 'per_diem_assignment',
  licenseType: 'RN', licenseNumber: 'RN1', licenseState: 'CA', licenseExpiration: '2028-03-15',
  yearsExperience: '3-5', primarySpecialty: 'icu',
  authorizedToWork: true, hasConviction: false, hasLicenseDiscipline: false, hasLicenseRevocation: false, underInvestigation: false,
  emergencyContactName: 'Jane', emergencyContactRelationship: 'Spouse', emergencyContactPhone: '555-000-1111',
};

const errorsFor = (override: Partial<Record<keyof EmploymentApplicationData, unknown>>) =>
  validateEmploymentApplication({ ...VALID, ...override } as EmploymentApplicationData);

describe('option lists — centralized', () => {
  it('Position Applied For is exactly CNA, LVN, RN, NP', () => {
    expect(POSITION_OPTIONS.map((o) => o.label)).toEqual(['CNA', 'LVN', 'RN', 'NP']);
  });

  it('unit preference options are exactly the UAT list', () => {
    expect(CLINICAL_UNIT_OPTIONS.map((o) => o.label)).toEqual([
      'Med-Surg', 'Tele-DOU', 'ICU', 'ER', 'PACU', 'SDS', 'OR', 'GI Lab', 'Anesthesia Tech.', 'L&D',
    ]);
  });

  it('primary specialty options are the unit list plus Other (one source, so a new unit appears in both)', () => {
    expect(PRIMARY_SPECIALTY_OPTIONS.map((o) => o.label)).toEqual([...CLINICAL_UNIT_OPTIONS.map((o) => o.label), 'Other']);
  });

  it('employment type is exactly Per-Diem Assignment and Travel Assignment', () => {
    expect(EMPLOYMENT_TYPE_OPTIONS.map((o) => o.label)).toEqual(['Per-Diem Assignment', 'Travel Assignment']);
  });

  it('shift preference is exactly AM, MID, PM', () => {
    expect(SHIFT_PREFERENCE_OPTIONS.map((o) => o.label)).toEqual(['AM', 'MID', 'PM']);
  });

  it('option values are unique within each list', () => {
    for (const list of [POSITION_OPTIONS, PRIMARY_SPECIALTY_OPTIONS, EMPLOYMENT_TYPE_OPTIONS, SHIFT_PREFERENCE_OPTIONS]) {
      const values = list.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('validateEmploymentApplication — position and CNA rule', () => {
  it.each(POSITION_OPTIONS.map((o) => o.value))('accepts %s', (position) => {
    expect(errorsFor({ positionApplied: position })).toEqual({});
  });

  it('rejects a value outside the four positions', () => {
    expect(errorsFor({ positionApplied: 'RN — Med/Surg' }).positionApplied).toBe('Select CNA, LVN, RN, or NP');
  });

  it('CNA: no unit preference required, and hidden/invalid unit values are ignored', () => {
    expect(errorsFor({ positionApplied: 'CNA', specialtyPreference: [] })).toEqual({});
    expect(errorsFor({ positionApplied: 'CNA', specialtyPreference: ['icu', 'not_a_unit'] })).toEqual({});
  });

  it.each(['LVN', 'RN', 'NP'])('%s: at least one unit is required', (position) => {
    expect(errorsFor({ positionApplied: position, specialtyPreference: [] }).specialtyPreference).toBe('Select at least one unit preference');
  });
});

describe('validateEmploymentApplication — unit preference (multi-select)', () => {
  it('accepts multiple units', () => {
    expect(errorsFor({ specialtyPreference: ['med_surg', 'tele_dou', 'l_and_d'] })).toEqual({});
  });

  it('accepts every unit together', () => {
    expect(errorsFor({ specialtyPreference: CLINICAL_UNIT_OPTIONS.map((o) => o.value) })).toEqual({});
  });

  it('rejects an unknown unit value', () => {
    expect(errorsFor({ specialtyPreference: ['icu', 'peds'] }).specialtyPreference).toBeTruthy();
  });
});

describe('validateEmploymentApplication — employment type', () => {
  it.each(['per_diem_assignment', 'travel_assignment'])('accepts %s', (type) => {
    expect(errorsFor({ employmentType: type })).toEqual({});
  });

  it.each(['full_time', 'part_time', 'per_diem'])('rejects legacy value %s without crashing', (legacy) => {
    expect(errorsFor({ employmentType: legacy }).employmentType).toBe('Select Per-Diem Assignment or Travel Assignment');
  });
});

describe('validateEmploymentApplication — shift preference (multi-select)', () => {
  it.each([[['am']], [['mid', 'pm']], [['am', 'mid', 'pm']]])('accepts %j', (shifts) => {
    expect(errorsFor({ shiftPreference: shifts })).toEqual({});
  });

  it('requires at least one and rejects unknown values', () => {
    expect(errorsFor({ shiftPreference: [] }).shiftPreference).toBe('Select at least one shift preference');
    expect(errorsFor({ shiftPreference: ['am', 'night'] }).shiftPreference).toBeTruthy();
  });

  it('a legacy string shift value never crashes validation', () => {
    expect(() => errorsFor({ shiftPreference: 'day' })).not.toThrow();
    expect(errorsFor({ shiftPreference: 'day' }).shiftPreference).toBeTruthy();
  });
});

describe('validateEmploymentApplication — license expiration', () => {
  it('accepts a real canonical date', () => {
    expect(errorsFor({ licenseExpiration: '2028-02-29' })).toEqual({});
  });

  it.each(['2027-02-29', '2028-13-01', '2028-04-31', '03-15-2028', '03-15', 'soon'])('rejects %s', (value) => {
    expect(errorsFor({ licenseExpiration: value }).licenseExpiration).toBe('Enter a valid date (MM-DD-YYYY)');
  });

  it('requires a value', () => {
    expect(errorsFor({ licenseExpiration: '' }).licenseExpiration).toBe('License expiration date is required');
  });
});

describe('validateEmploymentApplication — primary clinical specialty', () => {
  it.each(PRIMARY_SPECIALTY_OPTIONS.filter((o) => o.value !== 'other').map((o) => o.value))('accepts %s', (value) => {
    expect(errorsFor({ primarySpecialty: value })).toEqual({});
  });

  it('Other requires the Other text', () => {
    expect(errorsFor({ primarySpecialty: 'other', primarySpecialtyOther: '  ' }).primarySpecialtyOther).toBe('Please specify your primary specialty');
    expect(errorsFor({ primarySpecialty: 'other', primarySpecialtyOther: 'Pediatrics' })).toEqual({});
  });

  it('switching away from Other removes the requirement even with stale text present', () => {
    expect(errorsFor({ primarySpecialty: 'er', primarySpecialtyOther: 'Stale' })).toEqual({});
  });

  it('a session missing the new primarySpecialtyOther key validates without crashing', () => {
    const { primarySpecialtyOther: _omit, ...withoutOther } = VALID;
    expect(validateEmploymentApplication(withoutOther as EmploymentApplicationData)).toEqual({});
  });
});

describe('normalizeEmploymentApplication — backward compatibility', () => {
  it('legacy string unit preference → matching unit codes (unmatched free text dropped)', () => {
    expect(normalizeEmploymentApplication({ specialtyPreference: 'ICU, Med/Surg; L&D, Peds' }).specialtyPreference).toEqual(['icu', 'med_surg', 'l_and_d']);
  });

  it('legacy string shift preference → [] when it is not a current option', () => {
    expect(normalizeEmploymentApplication({ shiftPreference: 'day' }).shiftPreference).toEqual([]);
    expect(normalizeEmploymentApplication({ shiftPreference: 'AM' }).shiftPreference).toEqual(['am']);
  });

  it('legacy free-text primary specialty → Other with the text preserved', () => {
    const n = normalizeEmploymentApplication({ primarySpecialty: 'Critical Care' });
    expect(n.primarySpecialty).toBe('other');
    expect(n.primarySpecialtyOther).toBe('Critical Care');
    expect(normalizeEmploymentApplication({ primarySpecialty: 'Med-Surg' }).primarySpecialty).toBe('med_surg');
  });

  it('missing/garbage input yields the full default shape', () => {
    expect(normalizeEmploymentApplication(undefined)).toEqual(defaultFormData.employmentApplication);
    expect(normalizeEmploymentApplication('nope')).toEqual(defaultFormData.employmentApplication);
  });

  it('positions match case-insensitively; unknown text is kept for validation to reject', () => {
    expect(normalizeEmploymentApplication({ positionApplied: 'rn' }).positionApplied).toBe('RN');
    expect(normalizeEmploymentApplication({ positionApplied: 'ICU Travel RN' }).positionApplied).toBe('ICU Travel RN');
  });
});

describe('finalizeEmploymentApplication — submitted answers', () => {
  it('CNA: hidden unit selections are not submitted', () => {
    expect(finalizeEmploymentApplication({ ...VALID, positionApplied: 'CNA', specialtyPreference: ['icu'] }).specialtyPreference).toEqual([]);
  });

  it('non-CNA: unit selections are kept', () => {
    expect(finalizeEmploymentApplication({ ...VALID, specialtyPreference: ['icu', 'er'] }).specialtyPreference).toEqual(['icu', 'er']);
  });

  it('stale Other text is not submitted when a listed specialty is selected', () => {
    expect(finalizeEmploymentApplication({ ...VALID, primarySpecialty: 'er', primarySpecialtyOther: 'Stale' }).primarySpecialtyOther).toBe('');
    expect(finalizeEmploymentApplication({ ...VALID, primarySpecialty: 'other', primarySpecialtyOther: 'Peds' }).primarySpecialtyOther).toBe('Peds');
  });

  it('keeps the canonical license expiration format', () => {
    expect(finalizeEmploymentApplication(VALID).licenseExpiration).toBe('2028-03-15');
  });
});

describe('display formatting', () => {
  it('renders arrays and legacy strings human-readably', () => {
    expect(formatOptionValues(['icu', 'l_and_d'], CLINICAL_UNIT_OPTIONS)).toBe('ICU, L&D');
    expect(formatOptionValues(['am', 'mid', 'pm'], SHIFT_PREFERENCE_OPTIONS)).toBe('AM, MID, PM');
    expect(formatOptionValues('ICU, Peds', CLINICAL_UNIT_OPTIONS)).toBe('ICU, Peds'); // historical free text shown as-is
    expect(formatOptionValues([], SHIFT_PREFERENCE_OPTIONS)).toBe('');
  });

  it('primary specialty includes the Other text', () => {
    expect(formatPrimarySpecialty('other', 'Pediatrics')).toBe('Other — Pediatrics');
    expect(formatPrimarySpecialty('anesthesia_tech', 'ignored')).toBe('Anesthesia Tech.');
  });
});

describe('date helpers (MM-DD-YYYY display ⇄ YYYY-MM-DD storage)', () => {
  it('masks typed digits into MM-DD-YYYY', () => {
    expect(maskDisplayDateInput('0')).toBe('0');
    expect(maskDisplayDateInput('031')).toBe('03-1');
    expect(maskDisplayDateInput('03/15/2028')).toBe('03-15-2028');
    expect(maskDisplayDateInput('031520281234')).toBe('03-15-2028');
  });

  it('converts both ways and rejects impossible dates', () => {
    expect(displayDateToIso('03-15-2028')).toBe('2028-03-15');
    expect(displayDateToIso('02-30-2028')).toBeNull();
    expect(displayDateToIso('03-15')).toBeNull();
    expect(isoDateToDisplay('2028-03-15')).toBe('03-15-2028');
    expect(isoDateToDisplay('03-1')).toBe('03-1'); // partial input passes through unchanged
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
  });
});

describe('completion — employment application', () => {
  const formData = (ea: Partial<EmploymentApplicationData>) => ({ ...defaultFormData, employmentApplication: { ...VALID, ...ea } });

  it('a valid non-CNA application is 100% (18 items incl. units)', () => {
    expect(computeStepCompletion(formData({})).employment_application).toMatchObject({ completed: 18, total: 18, percent: 100 });
  });

  it('CNA has no unit item in the denominator, and is 100% with no units', () => {
    expect(computeStepCompletion(formData({ positionApplied: 'CNA', specialtyPreference: [] })).employment_application)
      .toMatchObject({ completed: 17, total: 17, percent: 100 });
  });

  it('Other without text, an invalid date, or a legacy employment type is not counted complete', () => {
    expect(computeStepCompletion(formData({ primarySpecialty: 'other', primarySpecialtyOther: '' })).employment_application.percent).toBeLessThan(100);
    expect(computeStepCompletion(formData({ licenseExpiration: '2027-02-30' })).employment_application.percent).toBeLessThan(100);
    expect(computeStepCompletion(formData({ employmentType: 'full_time' })).employment_application.percent).toBeLessThan(100);
  });

  it('a legacy-shaped session never crashes completion', () => {
    const legacy = { ...defaultFormData, employmentApplication: { ...VALID, specialtyPreference: 'ICU', shiftPreference: 'day' } as unknown as EmploymentApplicationData };
    expect(() => computeStepCompletion(legacy)).not.toThrow();
  });
});

describe('employment references — Supervisor Title', () => {
  const REF: EmploymentReference = {
    ...defaultEmploymentReference,
    positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '01/2022',
    employerName: 'Hospital', employerCity: 'LA', employerState: 'CA',
    supervisorName: 'Pat', supervisorPhone: '555-000-1111', supervisorTitle: 'Nurse Manager',
    permissionGranted: true, eligibleForRehire: true,
  };

  it('valid with supervisorTitle and no reasonForLeaving', () => {
    expect(validateEmploymentReference(REF)).toEqual({});
    expect(defaultEmploymentReference).not.toHaveProperty('reasonForLeaving');
  });

  it('supervisorTitle is required (whitespace is not enough)', () => {
    expect(validateEmploymentReference({ ...REF, supervisorTitle: '   ' }).supervisorTitle).toBe('Supervisor title is required');
  });

  it('a pre-change reference (reasonForLeaving, no supervisorTitle) gets a friendly required error, not a crash', () => {
    const { supervisorTitle: _omit, ...legacy } = REF;
    const errors = validateEmploymentReference({ ...legacy, reasonForLeaving: 'Relocation' } as EmploymentReference);
    expect(errors).toEqual({ supervisorTitle: 'Supervisor title is required' });
  });

  it('completion counts supervisorTitle, not reasonForLeaving, for every reference step', () => {
    const data = { ...defaultFormData, employmentReferences: { employment_ref_1: REF, employment_ref_2: REF, employment_ref_3: { ...REF, supervisorTitle: '' } } };
    const c = computeStepCompletion(data);
    expect(c.employment_ref_1.percent).toBe(100);
    expect(c.employment_ref_2.percent).toBe(100);
    expect(c.employment_ref_3.percent).toBeLessThan(100);
  });
});

describe('direct deposit — bank account verification', () => {
  it('still requires an uploaded verification document, with the broadened wording', () => {
    const errors = validateDirectDeposit(defaultFormData.directDepositData, null);
    expect(errors.directDepositProofDocument).toBe(
      'Upload a voided check or bank document showing your routing and account numbers to complete direct deposit authorization',
    );
  });
});
