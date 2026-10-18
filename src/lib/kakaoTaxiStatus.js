const EXCLUDED_STATUS_KEYS = new Set([
  'canceled',
  'cancelled',
  'refunded',
  'void',
  'failed',
  '취소',
  '환불',
]);

export const normalizeTaxiOrderStatus = (value = '') => String(value || '').trim().toLowerCase();

export const isExcludedTaxiOrderStatus = (value = '') => {
  const status = normalizeTaxiOrderStatus(value);
  return EXCLUDED_STATUS_KEYS.has(status)
    || status.includes('cancel')
    || status.includes('refund')
    || status.includes('취소')
    || status.includes('환불');
};
