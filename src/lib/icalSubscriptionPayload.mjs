export function normalizeIcalSubscriptionLabel(value = '') {
  return String(value || '').trim();
}

export function normalizeIcalSubscriptionDepts(depts = []) {
  return [...new Set(
    (depts || [])
      .map((dept) => String(dept || '').trim())
      .filter(Boolean),
  )];
}

export function buildIcalSubscriptionUpdatePayload({ depts, label } = {}) {
  const payload = {};
  if (depts !== undefined) payload.depts = normalizeIcalSubscriptionDepts(depts);
  if (label !== undefined) payload.label = normalizeIcalSubscriptionLabel(label);
  return payload;
}
