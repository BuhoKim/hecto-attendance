import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLatestProfile } from '../src/lib/adminEmployeeProfile.js';

test('pickLatestProfile chooses the most recently updated profile for duplicate employee profiles', () => {
  const profiles = [
    { id: 'old', emp_no: '001', rank: '선임', updated_at: '2026-08-01T00:00:00Z' },
    { id: 'new', emp_no: '001', rank: '책임', updated_at: '2026-09-01T00:00:00Z' },
  ];

  assert.equal(pickLatestProfile(profiles).id, 'new');
});

test('pickLatestProfile returns null when no profile exists', () => {
  assert.equal(pickLatestProfile([]), null);
});
