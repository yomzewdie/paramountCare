import {
  CNA_SPECIALTY,
  LICENSE_TYPE_OPTIONS,
  SPECIALTY_CODES_BY_POSITION,
  SPECIALTY_OPTIONS,
  activeSpecialtySelections,
  requiresUnitPreference,
  specialtyOptionsFor,
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
  positionApplied: 'RN', specialtyPreference: ['icu'], shiftPreference: ['am'], employmentType: ['per_diem_assignment'],
  licenseType: 'RN', licenseNumber: 'RN1', licenseState: 'CA', licenseExpiration: '2028-03-15',
  authorizedToWork: true, hasConviction: false, hasLicenseDiscipline: false, hasLicenseRevocation: false, underInvestigation: false,
  emergencyContactName: 'Jane', emergencyContactRelationship: 'Spouse', emergencyContactPhone: '555-000-1111',
};

const errorsFor = (override: Partial<Record<keyof EmploymentApplicationData, unknown>>) =>
  validateEmploymentApplication({ ...VALID, ...override } as EmploymentApplicationData);

describe('option lists — centralized', () => {
  it('Position Applied For is exactly CNA, Tech, LVN, RN, NP', () => {
    expect(POSITION_OPTIONS.map((o) => o.label)).toEqual(['CNA', 'Tech', 'LVN', 'RN', 'NP']);
  });

  it('License / Certification type uses the same five codes as Position', () => {
    expect(LICENSE_TYPE_OPTIONS.map((o) => o.value)).toEqual(POSITION_OPTIONS.map((o) => o.value));
  });

  const labelsFor = (position: string) => specialtyOptionsFor(position).map((o) => o.label);

  it('Tech specialties are exactly the UAT list', () => {
    expect(labelsFor('Tech')).toEqual(['Certified Surgical Tech (CST)', 'Anesthesia Tech', 'CT Tech', 'X-Ray Tech', 'Registered Respiratory Therapist', 'EMT']);
  });

  it('LVN specialties are exactly Med-Surg, Tele-DOU, ER', () => {
    expect(labelsFor('LVN')).toEqual(['Med-Surg', 'Tele-DOU', 'ER']);
  });

  it.each(['RN', 'NP'])('%s specialties are exactly the UAT list', (position) => {
    expect(labelsFor(position)).toEqual([
      'Med-Surg', 'Tele-DOU', 'ICU', 'ER', 'OR', 'PACU', 'SDS (Same-Day Surgery)', 'L&D / Post-Partum', 'Nursery / NICU',
      'PICU', 'Cath Lab', 'Interventional Radiology', 'GI Lab', 'Acute Dialysis', 'Psychiatric',
    ]);
  });

  it('CNA is never offered a choice; its canonical value is CNA', () => {
    expect(requiresUnitPreference('CNA')).toBe(false);
    expect(activeSpecialtySelections('CNA', [])).toEqual([CNA_SPECIALTY]);
    expect(activeSpecialtySelections('CNA', ['icu', 'cst'])).toEqual([CNA_SPECIALTY]);
    expect(formatOptionValues([CNA_SPECIALTY], SPECIALTY_OPTIONS)).toBe('CNA');
  });

  it('every position-specific code exists in the shared catalog, with a unique value', () => {
    const values = SPECIALTY_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const position of POSITION_OPTIONS.map((o) => o.value)) {
      for (const code of SPECIALTY_CODES_BY_POSITION[position]) expect(values).toContain(code);
    }
  });

  it('legacy primary specialty options are the catalog (minus CNA) plus Other', () => {
    expect(PRIMARY_SPECIALTY_OPTIONS.map((o) => o.value)).toEqual([...SPECIALTY_OPTIONS.filter((o) => o.value !== CNA_SPECIALTY).map((o) => o.value), 'other']);
  });

  it('employment type is exactly Per-Diem Assignment and Travel Assignment', () => {
    expect(EMPLOYMENT_TYPE_OPTIONS.map((o) => o.label)).toEqual(['Per-Diem Assignment', 'Travel Assignment']);
  });

  it('shift preference is exactly AM, MID, PM', () => {
    expect(SHIFT_PREFERENCE_OPTIONS.map((o) => o.label)).toEqual(['AM', 'MID', 'PM']);
  });

  it('option values are unique within each list', () => {
    for (const list of [POSITION_OPTIONS, PRIMARY_SPECIALTY_OPTIONS, EMPLOYMENT_TYPE_OPTIONS, SHIFT_PREFERENCE_OPTIONS, LICENSE_TYPE_OPTIONS]) {
      const values = list.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('validateEmploymentApplication — position and specialty routing', () => {
  it.each([
    ['CNA', []],
    ['Tech', ['cst']],
    ['LVN', ['med_surg']],
    ['RN', ['icu', 'picu']],
    ['NP', ['psychiatric']],
  ])('accepts %s with a valid specialty for that position', (position, specialties) => {
    expect(errorsFor({ positionApplied: position, licenseType: position, specialtyPreference: specialties })).toEqual({});
  });

  it('rejects a value outside the five positions', () => {
    expect(errorsFor({ positionApplied: 'RN — Med/Surg' }).positionApplied).toBe('Select CNA, Tech, LVN, RN, or NP');
  });

  it('CNA: no specialty required, and hidden selections are ignored', () => {
    expect(errorsFor({ positionApplied: 'CNA', specialtyPreference: [] })).toEqual({});
    expect(errorsFor({ positionApplied: 'CNA', specialtyPreference: ['icu', 'not_a_unit'] })).toEqual({});
  });

  it.each(['Tech', 'LVN', 'RN', 'NP'])('%s: at least one specialty is required', (position) => {
    expect(errorsFor({ positionApplied: position, specialtyPreference: [] }).specialtyPreference).toBe('Select at least one specialty / unit preference');
  });

  it.each([
    ['Tech', ['icu', 'med_surg']],
    ['LVN', ['icu', 'picu']],
    ['RN', ['cst', 'emt']],
  ])('%s: selections that belong to another position are not active (still required to pick a valid one)', (position, specialties) => {
    expect(errorsFor({ positionApplied: position, specialtyPreference: specialties }).specialtyPreference).toBeTruthy();
  });

  it('switching RN → Tech keeps RN drafts stored but makes only Tech selections active', () => {
    expect(activeSpecialtySelections('Tech', ['icu', 'er', 'rrt'])).toEqual(['rrt']);
    expect(activeSpecialtySelections('RN', ['icu', 'er', 'rrt'])).toEqual(['icu', 'er']);
  });

  it('license type must be one of the five (legacy "other" needs re-selecting)', () => {
    expect(errorsFor({ licenseType: 'Tech' })).toEqual({});
    expect(errorsFor({ licenseType: 'other' }).licenseType).toBe('Select CNA, Tech, LVN, RN, or NP');
  });
});

describe('validateEmploymentApplication — unit preference (multi-select)', () => {
  it('accepts multiple units', () => {
    expect(errorsFor({ specialtyPreference: ['med_surg', 'tele_dou', 'l_and_d'] })).toEqual({});
  });

  it('accepts every RN unit together', () => {
    expect(errorsFor({ specialtyPreference: [...SPECIALTY_CODES_BY_POSITION.RN] })).toEqual({});
  });

  it('an unknown unit alongside a valid one is simply not active', () => {
    expect(errorsFor({ specialtyPreference: ['icu', 'peds'] })).toEqual({});
    expect(errorsFor({ specialtyPreference: ['peds'] }).specialtyPreference).toBeTruthy();
  });
});

describe('validateEmploymentApplication — employment type (multi-select)', () => {
  it.each([[['per_diem_assignment']], [['travel_assignment']], [['per_diem_assignment', 'travel_assignment']]])('accepts %j', (types) => {
    expect(errorsFor({ employmentType: types })).toEqual({});
  });

  it('requires at least one', () => {
    expect(errorsFor({ employmentType: [] }).employmentType).toBe('Select at least one employment type');
  });

  it('a session saved with the old single value is read as a one-item list', () => {
    expect(normalizeEmploymentApplication({ employmentType: 'travel_assignment' }).employmentType).toEqual(['travel_assignment']);
    expect(errorsFor({ employmentType: 'travel_assignment' })).toEqual({});
  });

  it.each(['full_time', 'part_time', 'per_diem'])('rejects legacy value %s without crashing', (legacy) => {
    expect(errorsFor({ employmentType: legacy }).employmentType).toBe('Select Per-Diem Assignment, Travel Assignment, or both');
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

describe('validateEmploymentApplication — resume-first (experience comes from the resume)', () => {
  it('the default shape carries no legacy work-history/experience keys', () => {
    for (const key of ['yearsExperience', 'primarySpecialty', 'primarySpecialtyOther', 'currentlyEmployed', 'previouslyWorkedHere', 'hasCPR', 'cprCertNumber', 'cprExpiration']) {
      expect(defaultFormData.employmentApplication).not.toHaveProperty(key);
    }
  });

  it('is valid with no experience fields at all', () => {
    expect(validateEmploymentApplication(VALID)).toEqual({});
  });

  it('a legacy experience value is neither required nor rejected (even Other without text)', () => {
    expect(errorsFor({ yearsExperience: '', primarySpecialty: 'other', primarySpecialtyOther: '  ' })).toEqual({});
    expect(errorsFor({ primarySpecialty: 'Critical Care (free text)' })).toEqual({});
  });

  it.each([
    'positionApplied', 'employmentType', 'licenseType', 'licenseNumber', 'licenseState', 'licenseExpiration',
    'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
  ] as const)('still requires the structured field %s', (field) => {
    expect(errorsFor({ [field]: '' })[field]).toBeTruthy();
  });

  it.each(['authorizedToWork', 'hasConviction', 'hasLicenseDiscipline', 'hasLicenseRevocation', 'underInvestigation'] as const)(
    'still requires the eligibility/background answer %s',
    (field) => {
      expect(errorsFor({ [field]: null })[field]).toBeTruthy();
    },
  );
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

  it('new data never gains legacy keys; legacy keys on old data are passed through', () => {
    const fresh = normalizeEmploymentApplication({ positionApplied: 'RN' });
    expect(fresh).not.toHaveProperty('primarySpecialty');
    expect(fresh).not.toHaveProperty('yearsExperience');
    const old = normalizeEmploymentApplication({ positionApplied: 'RN', yearsExperience: '3-5', hasCPR: true, primarySpecialty: 'icu' });
    expect(old).toMatchObject({ yearsExperience: '3-5', hasCPR: true, primarySpecialty: 'icu', primarySpecialtyOther: '' });
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
  it('CNA: hidden unit selections are not submitted — the canonical CNA value is (never an empty list)', () => {
    expect(finalizeEmploymentApplication({ ...VALID, positionApplied: 'CNA', specialtyPreference: ['icu'] }).specialtyPreference).toEqual(['cna']);
    expect(finalizeEmploymentApplication({ ...VALID, positionApplied: 'CNA', specialtyPreference: [] }).specialtyPreference).toEqual(['cna']);
  });

  it('RN → Tech: only Tech selections are submitted', () => {
    expect(finalizeEmploymentApplication({ ...VALID, positionApplied: 'Tech', specialtyPreference: ['icu', 'er', 'ct_tech'] }).specialtyPreference).toEqual(['ct_tech']);
  });

  it('employment type is submitted as a list, legacy single values included', () => {
    expect(finalizeEmploymentApplication({ ...VALID, employmentType: 'per_diem_assignment' }).employmentType).toEqual(['per_diem_assignment']);
    expect(finalizeEmploymentApplication({ ...VALID, employmentType: ['per_diem_assignment', 'travel_assignment'] }).employmentType).toEqual(['per_diem_assignment', 'travel_assignment']);
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
    expect(formatOptionValues(['icu', 'l_and_d'], CLINICAL_UNIT_OPTIONS)).toBe('ICU, L&D / Post-Partum');
    expect(formatOptionValues(['am', 'mid', 'pm'], SHIFT_PREFERENCE_OPTIONS)).toBe('AM, MID, PM');
    expect(formatOptionValues('ICU, Peds', CLINICAL_UNIT_OPTIONS)).toBe('ICU, Peds'); // historical free text shown as-is
    expect(formatOptionValues([], SHIFT_PREFERENCE_OPTIONS)).toBe('');
  });

  it('primary specialty includes the Other text', () => {
    expect(formatPrimarySpecialty('other', 'Pediatrics')).toBe('Other — Pediatrics');
    expect(formatPrimarySpecialty('anesthesia_tech', 'ignored')).toBe('Anesthesia Tech');
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

  it('a valid non-CNA application is 100% (16 items incl. units)', () => {
    expect(computeStepCompletion(formData({})).employment_application).toMatchObject({ completed: 16, total: 16, percent: 100 });
  });

  it('CNA has no unit item in the denominator, and is 100% with no units', () => {
    expect(computeStepCompletion(formData({ positionApplied: 'CNA', specialtyPreference: [] })).employment_application)
      .toMatchObject({ completed: 15, total: 15, percent: 100 });
  });

  it('an invalid date or a legacy employment type is not counted complete; legacy experience fields never count', () => {
    expect(computeStepCompletion(formData({ primarySpecialty: 'other', primarySpecialtyOther: '' })).employment_application.percent).toBe(100);
    expect(computeStepCompletion(formData({ licenseExpiration: '2027-02-30' })).employment_application.percent).toBeLessThan(100);
    expect(computeStepCompletion(formData({ employmentType: 'full_time' as unknown as string[] })).employment_application.percent).toBeLessThan(100);
  });

  it('a legacy-shaped session never crashes completion', () => {
    const legacy = { ...defaultFormData, employmentApplication: { ...VALID, specialtyPreference: 'ICU', shiftPreference: 'day' } as unknown as EmploymentApplicationData };
    expect(() => computeStepCompletion(legacy)).not.toThrow();
  });
});

describe('employment references — resume-first (who to contact + permission)', () => {
  const REF: EmploymentReference = {
    ...defaultEmploymentReference,
    supervisorName: 'Pat', supervisorTitle: 'Nurse Manager', employerName: 'Hospital',
    supervisorPhone: '555-000-1111', permissionGranted: true,
  };

  it('the default shape carries no work-history keys', () => {
    for (const key of ['positionHeld', 'employmentDateFrom', 'employmentDateTo', 'employerCity', 'employerState', 'eligibleForRehire', 'rehireDetails', 'comments']) {
      expect(defaultEmploymentReference).not.toHaveProperty(key);
    }
  });

  it.each(['supervisorName', 'supervisorTitle', 'employerName', 'supervisorPhone'] as const)('requires %s', (field) => {
    expect(validateEmploymentReference({ ...REF, [field]: '' })[field]).toBeTruthy();
  });

  it('requires permission to contact', () => {
    expect(validateEmploymentReference({ ...REF, permissionGranted: false }).permissionGranted).toBeTruthy();
  });

  it('email is optional, but must be valid when provided', () => {
    expect(validateEmploymentReference({ ...REF, supervisorEmail: '' })).toEqual({});
    expect(validateEmploymentReference({ ...REF, supervisorEmail: 'pat@hospital.org' })).toEqual({});
    expect(validateEmploymentReference({ ...REF, supervisorEmail: 'not-an-email' }).supervisorEmail).toBeTruthy();
  });

  it('rehire eligibility is no longer asked or required', () => {
    expect(validateEmploymentReference({ ...REF, eligibleForRehire: null })).toEqual({});
    expect(validateEmploymentReference({ ...REF, eligibleForRehire: false, rehireDetails: '' })).toEqual({});
  });

  it('a reference saved by the old manual form is still valid', () => {
    expect(validateEmploymentReference({
      ...REF, positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '01/2022',
      employerCity: 'LA', employerState: 'CA', eligibleForRehire: true, rehireDetails: '', comments: '',
    })).toEqual({});
  });

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
