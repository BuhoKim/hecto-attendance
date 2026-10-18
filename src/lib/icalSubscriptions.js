import { getAdminClient } from './supabaseClient';
import { normalizeIcalDeptList } from './icalToken';
import {
  buildIcalSubscriptionUpdatePayload,
  normalizeIcalSubscriptionLabel,
} from './icalSubscriptionPayload.mjs';

export const ICAL_SUBSCRIPTION_TABLE = 'sa_ical_subscriptions';

export { buildIcalSubscriptionUpdatePayload, normalizeIcalSubscriptionLabel } from './icalSubscriptionPayload.mjs';

export function buildIcalSubscriptionPayload({ token, label, depts, createdBy = null, ownerEmpNo = null, scope = 'leave-calendar' } = {}) {
  return {
    token,
    label: normalizeIcalSubscriptionLabel(label),
    depts: normalizeIcalDeptList(depts),
    created_by: createdBy,
    owner_emp_no: ownerEmpNo,
    scope: String(scope || 'leave-calendar'),
  };
}

export async function createIcalSubscriptionRecord(payload = {}) {
  const supabase = getAdminClient();
  const row = buildIcalSubscriptionPayload(payload);
  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .insert({
      ...row,
      is_active: true,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listIcalSubscriptionRecords() {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .select('id, token, label, depts, scope, owner_emp_no, is_active, revoked_at, created_by, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function getIcalSubscriptionRecordByToken(token) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .select('id, token, label, depts, scope, owner_emp_no, is_active, revoked_at, created_by, created_at, updated_at')
    .eq('token', String(token || '').trim())
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function revokeIcalSubscriptionRecord(token) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('token', String(token || '').trim())
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function setIcalSubscriptionRecordActive(token, isActive = true) {
  const supabase = getAdminClient();
  const payload = {
    is_active: Boolean(isActive),
    updated_at: new Date().toISOString(),
  };

  if (isActive) {
    payload.revoked_at = null;
  } else {
    payload.revoked_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .update(payload)
    .eq('token', String(token || '').trim())
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function updateIcalSubscriptionRecord(token, updates = {}) {
  const supabase = getAdminClient();
  const payload = {
    ...buildIcalSubscriptionUpdatePayload(updates),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .update(payload)
    .eq('token', String(token || '').trim())
    .select()
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function deleteIcalSubscriptionRecord(token) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from(ICAL_SUBSCRIPTION_TABLE)
    .delete()
    .eq('token', String(token || '').trim())
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export function buildSubscriptionAccessUrls(baseUrl, token) {
  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');
  const encodedToken = encodeURIComponent(token);
  const url = `${normalizedBase}/api/ical/subscriptions.ics?token=${encodedToken}`;
  return {
    url,
    webcalUrl: `webcal://${new URL(url).host}${new URL(url).pathname}?token=${encodedToken}`,
  };
}
