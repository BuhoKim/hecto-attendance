const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kstStart, compactKst, rowTime, normalize, send, stableSnapshot, readAttendance } = require('../sync/hrHubSync');

test('three-day boundary follows Korea time', () => {
  const from = kstStart(3, new Date('2026-11-09T15:10:00Z'));
  assert.equal(from, '2026-11-06T15:00:00.000Z');
  assert.equal(compactKst(from), '20261107000000');
  assert.equal(rowTime('20261110085123'), '2026-11-10T08:51:23+09:00');
});
test('time fields are shortened and missing identifiers rejected', () => {
  assert.deepEqual(normalize('sa_employee_schedules', [{emp_no:'10', schedule_time:'08:30:00', schedule_end_time:null}]), [{emp_no:'10', schedule_time:'08:30', schedule_end_time:null}]);
  assert.throws(() => normalize('sa_employees', [{emp_no:null}]));
});
test('send refuses errors and validates response counts', async () => {
  const rows = [{emp_no:'10',log_time:'2026-11-10T08:00:00+09:00'}];
  let payload;
  const ok = async (_, request) => { payload = JSON.parse(request.body); return {ok:true,status:200,json:async()=>({ok:true,received:1,written:1})}; };
  await send('secret', 'sa_attendance', rows, 'replace', '2026-11-06T15:00:00.000Z', ok);
  assert.equal(payload.p_from, '2026-11-06T15:00:00.000Z');
  await assert.rejects(send('secret','sa_attendance',[],'replace',null,ok));
  await assert.rejects(send('secret','sa_attendance',rows,'append',null,async()=>({ok:true,status:200,json:async()=>({ok:false,error:'bad'})})));
  await assert.rejects(send('secret','sa_attendance',rows,'append',null,async()=>({ok:true,status:200,json:async()=>({ok:true,received:0,written:0})})));
});
test('snapshot rejects a changing source', async () => {
  let n=0;
  const db = { from() { return { select() { return { order() { return { range: async () => ({data:[{emp_no:String(++n)}],count:1,error:null}) }; } }; } }; } };
  await assert.rejects(stableSnapshot(db,'sa_employees','emp_no','emp_no'), /원본 변경/);
});
test('source records are mapped and duplicates are ignored', async () => {
  let call = 0;
  const conn = { execute: async () => [++call === 1
    ? [{emp_no:'123', a_time:'20261110085123'}]
    : [{emp_no:'00000123', e_date:'20261110', e_time:'085123'}]] };
  const rows = await readAttendance(conn, '2026-11-06T15:00:00Z');
  assert.deepEqual(rows, [{emp_no:'123',log_time:'2026-11-10T08:51:23+09:00'}]);
});
