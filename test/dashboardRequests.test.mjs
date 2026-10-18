import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/loadSource.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = marker => ({ ok: true, status: 200, json: async () => ({ success: true, marker, leaves: [], allEmployees: [] }) });

function harness(fetch) {
  let slots = [], cursor = 0, effects = [], mounted = true, queued = false;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => {
        const next = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; scheduleRender(); }
      }];
    },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    useEffectEvent(fn) { const ref = react.useRef(fn); ref.current = fn; return react.useCallback((...args) => ref.current(...args), []); },
  };
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  const timers = new Map(); let timerId = 0;
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const load = sourceLoader({ react }, { fetch, document, Date: Clock, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id), console: { error() {} } });
  const { useDashboardData } = load('src/hooks/useDashboardData.js');
  const h = { props: { activeTab: 'TRACKER', selectedEmployee: '001', setSelectedEmployee() {}, myEmpNo: '001', isAdmin: false, selectedMonth: '2026-08', calendarMonth: '2026-09' }, result: null, timers, setNow: value => { now = value; } };
  function render() { cursor = 0; effects = []; h.result = useDashboardData(h.props); const run = effects; effects = []; run.forEach(fn => fn()); }
  function scheduleRender() { if (!queued && mounted) { queued = true; queueMicrotask(() => { queued = false; if (mounted) render(); }); } }
  h.render = updates => { Object.assign(h.props, updates); render(); };
  h.stop = () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); };
  render();
  return h;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('older month response cannot overwrite the selected month or its loading state', async t => {
  const august = deferred(), september = deferred();
  const h = harness(url => url.includes('empNo=') ? (url.includes('2026-08') ? august.promise : september.promise) : Promise.resolve(response('other')));
  t.after(h.stop);
  await settle(); h.render({ selectedMonth: '2026-09' }); await settle();
  september.resolve(response('September')); await settle();
  assert.equal(h.result.monthlyData.marker, 'September');
  august.resolve(response('August')); await settle();
  assert.equal(h.result.monthlyData.marker, 'September');
});

test('cached month is revalidated after expiry and refresh invalidates it immediately', async t => {
  let revision = 1;
  const h = harness(async () => response(revision)); t.after(h.stop);
  await settle(); assert.equal(h.result.monthlyData.marker, 1);
  revision = 2; h.render({ selectedMonth: '2026-09' }); await settle();
  h.setNow(10 * 60 * 1000); h.render({ selectedMonth: '2026-08' }); await settle();
  assert.equal(h.result.monthlyData.marker, 2);
  revision = 3; await h.result.refreshAllData(); await settle();
  assert.equal(h.result.monthlyData.marker, 3);
});

test('monthly employee leaves never replace the independent calendar month', async t => {
  const monthly = deferred();
  const h = harness(url => url.includes('empNo=') ? monthly.promise : Promise.resolve({ ...response('calendar'), json: async () => ({ success: true, leaves: [{ id: 'calendar-month' }] }) }));
  t.after(h.stop); await settle();
  monthly.resolve({ ...response('month'), json: async () => ({ success: true, leaves: [{ id: 'employee-only' }] }) }); await settle();
  assert.equal(h.result.calendarLeaves[0]?.id, 'calendar-month');
});

test('failed scheduled refresh backs off and does not rearm after cleanup', async t => {
  let fail = false;
  const h = harness(async () => { if (fail) throw new Error('offline'); return response('ok'); });
  t.after(h.stop); await settle();
  fail = true;
  const timer = [...h.timers.values()].find(entry => entry.delay === 300000);
  h.timers.clear(); await timer.fn(); await settle();
  assert.ok([...h.timers.values()].some(entry => entry.delay === 600000));
  assert.equal(await h.result.fetchTodayData(true), false);
});
