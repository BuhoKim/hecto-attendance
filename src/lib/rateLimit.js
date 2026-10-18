const buckets = new Map();

function now() {
  return Date.now();
}

function cleanup(timestamp) {
  if (buckets.size < 2000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= timestamp) buckets.delete(key);
  }
}

export function getRequestIp(request) {
  const forwarded = request?.headers?.get?.('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || request?.headers?.get?.('x-real-ip') || 'unknown';
}

export function checkRateLimit(key, { limit = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const timestamp = now();
  cleanup(timestamp);
  const current = buckets.get(key);

  if (!current || current.resetAt <= timestamp) {
    buckets.set(key, { count: 1, resetAt: timestamp + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }

  current.count += 1;
  const allowed = current.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - current.count),
    retryAfter: Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000)),
  };
}

export function clearRateLimit(key) {
  buckets.delete(key);
}
