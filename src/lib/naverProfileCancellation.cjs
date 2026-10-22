// Match only the leave status type, message and start day this integration uses.
// Retain any equivalent approved leave, and retry failed cleanup next cycle.
async function removeCancelledProfileStatuses({ leaves, getAccessToken, calculateWindow, fetchImpl = fetch, now = Date.now() }) {
  const groups = new Map();
  const identity = (window) => JSON.stringify([window.profileStatusId, window.statusMessage, window.startTime.slice(0, 10)]);
  for (const leave of leaves) {
    const email = leave.email || leave.emp_email;
    const window = calculateWindow(leave);
    if (!email?.includes('@') || !window) continue;
    if (!groups.has(email)) groups.set(email, { approved: new Set(), cancelled: new Set() });
    const group = groups.get(email);
    // Ended approved leaves are cleanup candidates too: a previously longer
    // profile status may still be active after HR shortened that same leave.
    const activeApproval = (!leave.status || String(leave.status) === '40') && new Date(window.endTime).getTime() > now;
    (activeApproval ? group.approved : group.cancelled).add(identity(window));
  }
  let deleted = 0;
  for (const [email, group] of groups) {
    if (![...group.cancelled].some((key) => !group.approved.has(key))) continue;
    const token = await getAccessToken();
    if (!token) throw new Error('휴가 상태 취소 인증 실패');
    const url = `https://www.worksapis.com/v1.0/users/${encodeURIComponent(email)}/user-profile-statuses`;
    const headers = { Authorization: `Bearer ${token}` };
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`휴가 상태 취소 조회 실패 (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.userProfileStatuses)) throw new Error('휴가 상태 취소 조회 응답 오류');
    for (const item of data.userProfileStatuses) {
      if (!item.startTime || !item.userProfileStatusId || new Date(item.endTime).getTime() <= now) continue;
      const key = identity(item);
      if (!group.cancelled.has(key) || group.approved.has(key)) continue;
      const result = await fetchImpl(`${url}/${encodeURIComponent(item.userProfileStatusId)}`, { method: 'DELETE', headers });
      if (!result.ok && result.status !== 404) throw new Error(`휴가 상태 취소 실패 (${result.status})`);
      deleted++;
    }
  }
  return deleted;
}

module.exports = { removeCancelledProfileStatuses };
