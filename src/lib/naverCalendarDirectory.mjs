let cachedUsers;
let expiresAt = 0;

export async function getCalendarDirectoryUsers(token) {
  if (cachedUsers && Date.now() < expiresAt) return cachedUsers;
  const users = [];
  let cursor = '';
  const seen = new Set();
  do {
    if (seen.has(cursor)) throw new Error('겸직 조직 조회 커서가 반복됩니다.');
    seen.add(cursor);
    const params = new URLSearchParams({ count: '100', ...(cursor ? { cursor } : {}) });
    const response = await fetch(`https://www.worksapis.com/v1.0/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`겸직 조직 조회 실패 (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.users)) throw new Error('겸직 조직 응답이 올바르지 않습니다.');
    users.push(...data.users);
    cursor = data.responseMetaData?.nextCursor || '';
  } while (cursor);
  cachedUsers = users;
  expiresAt = Date.now() + 5 * 60000;
  return users;
}
