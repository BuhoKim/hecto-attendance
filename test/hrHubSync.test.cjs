const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kstStart, compactKst, rowTime, normalize, send, stableSnapshot, readAttendance, syncIncremental, loadCheckpoint, saveCheckpoint } = require('../sync/hrHubSync');

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
test('checkpoint persists after success and overlaps five minutes on restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrhub-test-'));
  const file = path.join(dir, 'checkpoint.json');
  try {
    const load = () => loadCheckpoint(file), save = t => saveCheckpoint(file, t);
    let from;
    await syncIncremental({read: async f => { from = f; return [{emp_no:'1'}]; }, sendBatch: async () => ({written:1}), load, save, now:new Date('2026-11-10T00:00:00Z')});
    assert.equal(from, '2026-11-06T15:00:00.000Z');
    assert.equal(loadCheckpoint(file), '2026-11-10T00:00:00.000Z');
    await syncIncremental({read: async f => { from = f; return []; }, sendBatch: async () => { throw new Error('unexpected'); }, load, save, now:new Date('2026-11-10T00:03:00Z')});
    assert.equal(from, '2026-11-09T23:55:00.000Z');
    assert.equal(loadCheckpoint(file), '2026-11-10T00:03:00.000Z');
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
test('partial batch failure does not advance the checkpoint', async () => {
  let saved = false, sent = 0;
  const rows = Array.from({length:501}, () => ({emp_no:'1'}));
  await assert.rejects(syncIncremental({read: async()=>rows, sendBatch: async()=>{ if (++sent === 2) throw new Error('offline'); return {written:500}; }, load:()=> '2026-11-10T00:00:00.000Z', save:()=>{ saved=true; }, now:new Date('2026-11-10T00:03:00Z')}), /offline/);
  assert.equal(saved, false);
});
test('invalid checkpoint or clock causes a safe failure', async () => {
  let saved = false;
  await assert.rejects(syncIncremental({read: async()=>[], sendBatch: async()=>({written:0}), load:()=> '2026-11-11T00:00:00.000Z', save:()=>{saved=true;}, now:new Date('2026-11-10T00:00:00Z')}), /미래/);
  assert.equal(saved, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrhub-test-'));
  try { const file = path.join(dir, 'checkpoint.json'); fs.writeFileSync(file, '{'); assert.throws(() => loadCheckpoint(file), /손상/); }
  finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
