export function pickLatestProfile(profiles = []) {
  return [...profiles]
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0] || null;
}
