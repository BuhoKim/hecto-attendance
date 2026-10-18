// Per-mounted-dashboard cache. In-flight requests share a promise; invalidation
// prevents an old response from restoring data after a user explicitly refreshes.
export function createDashboardRequestCache({ ttlMs = 60_000, maxEntries = 24 } = {}) {
  const entries = new Map();
  const pending = new Map();
  let generation = 0;
  return {
    clear() { generation++; entries.clear(); pending.clear(); },
    async get(url, { force = false } = {}) {
      if (pending.has(url)) return pending.get(url);
      const cached = entries.get(url);
      if (!force && cached && Date.now() - cached.timestamp < ttlMs) return cached.data;
      const requestGeneration = generation;
      const request = (async () => {
        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data?.success) {
          const error = new Error(data?.error || '데이터를 불러오지 못했습니다.');
          error.status = response.status;
          throw error;
        }
        if (requestGeneration === generation) {
          entries.delete(url);
          entries.set(url, { data, timestamp: Date.now() });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        }
        return data;
      })();
      pending.set(url, request);
      try { return await request; }
      finally { if (pending.get(url) === request) pending.delete(url); }
    },
  };
}
