/**
 * hr_employee 재직상태(I_STATE_CODE) → sa_employees 매핑 헬퍼
 * 001 재직 / 002 휴직 / 999 퇴직, D_STATE_DATE는 상태 적용일자
 */

const STATE_CODE_TO_STATUS = {
  '001': 'active',
  '002': 'leave',
  '999': 'resigned',
};

function normalizeStateCode(value) {
  const code = String(value ?? '').trim();
  return STATE_CODE_TO_STATUS[code] ? code : null;
}

function stateCodeToStatus(code) {
  return STATE_CODE_TO_STATUS[String(code ?? '').trim()] || null;
}

function stateDateToPgDate(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function employeeStateFromMysqlRow(row) {
  const stateCode = normalizeStateCode(row?.I_STATE_CODE);
  return {
    stateCode,
    stateDate: stateCode ? stateDateToPgDate(row?.D_STATE_DATE) : null,
    status: stateCodeToStatus(stateCode),
  };
}

module.exports = { STATE_CODE_TO_STATUS, employeeStateFromMysqlRow };
