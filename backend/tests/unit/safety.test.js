import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoseAmount, checkDoseRanges } from '../../src/services/safetyService.js';
import { capabilityStatement, toFhirPatient } from '../../src/services/fhirService.js';

describe('safetyService', () => {
  it('parses the first number from a dosage string', () => {
    assert.equal(parseDoseAmount('500 mg TDS'), 500);
    assert.equal(parseDoseAmount('no dose'), null);
  });

  it('flags a dose above the formulary maximum', () => {
    const drugs = [{ _id: '1', name: 'Warfarin 5', minDailyDose: 1, maxDailyDose: 10, doseUnit: 'mg' }];
    const warnings = checkDoseRanges({
      drugs,
      items: [{ drugId: '1', dosage: '15 mg daily' }],
    });
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].kind, 'above-maximum');
  });
});

describe('fhirService', () => {
  it('advertises R4 Patient Encounter Observation MedicationRequest', () => {
    const cap = capabilityStatement();
    assert.equal(cap.fhirVersion, '4.0.1');
    const types = cap.rest[0].resource.map((r) => r.type);
    assert.deepEqual(types.sort(), ['Encounter', 'MedicationRequest', 'Observation', 'Patient']);
  });

  it('maps an HMS patient to FHIR Patient', () => {
    const resource = toFhirPatient({
      _id: 'abc',
      mrn: 'MRN-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'female',
      dateOfBirth: '1815-12-10',
      status: 'active',
      isActive: true,
      phone: '1',
    });
    assert.equal(resource.resourceType, 'Patient');
    assert.equal(resource.identifier[0].value, 'MRN-1');
    assert.equal(resource.name[0].family, 'Lovelace');
  });
});
