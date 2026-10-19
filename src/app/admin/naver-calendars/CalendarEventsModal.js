'use client';

import { useEffect, useRef, useState } from 'react';

export default function CalendarEventsModal({ dept, onClose }) {
  const dialog = useRef(null);
  const [month, setMonth] = useState(() => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7));
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      setResult(null);
      try {
        const params = new URLSearchParams({ view: 'events', dept, month });
        const res = await fetch(`/api/admin/naver-calendars?${params}`, { cache: 'no-store', signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '조회에 실패했습니다.');
        setResult(data);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [dept, month, reload]);

  const events = result?.events || [];
  const visible = events.filter((event) => `${event.title} ${event.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const duplicateCount = events.filter((event) => event.duplicate).length;
  const buttonStyle = { padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-card-2)', color: 'var(--text-1)', cursor: 'pointer' };
  function shiftMonth(delta) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
  }

  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="calendar-events-title" style={{ width: 'min(860px, calc(100vw - 32px))', maxHeight: '85vh', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg-card)', color: 'var(--text-1)' }}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 id="calendar-events-title" style={{ fontSize: 18, margin: 0 }}>[{dept}] 휴가 등록 내역</h2>
          <button type="button" onClick={onClose} style={buttonStyle} autoFocus>닫기</button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>네이버웍스 캘린더에 실제 저장된 일정입니다. 저장 전 변경 사항은 반영되지 않습니다.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => shiftMonth(-1)} style={buttonStyle} aria-label="이전 달">‹</button>
          <input type="month" aria-label="조회 월" min="1900-01" max="2200-12" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} className="search-input" style={{ width: 170 }} />
          <button type="button" onClick={() => shiftMonth(1)} style={buttonStyle} aria-label="다음 달">›</button>
          <input aria-label="휴가 내역 검색" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·휴가종류 검색" className="search-input" style={{ flex: 1, minWidth: 180 }} />
          <button type="button" onClick={() => setReload((n) => n + 1)} disabled={loading} style={buttonStyle}>새로고침</button>
        </div>
        <div aria-live="polite" style={{ fontSize: 13 }}>
          {loading ? '네이버웍스에서 실제 일정을 확인하고 있습니다…' : error ? <span style={{ color: 'var(--red)' }}>{error}</span> : <>
            총 {events.length}건 · 검색 결과 {visible.length}건
            {duplicateCount > 0 && <span style={{ color: 'var(--red)', marginLeft: 12 }}>중복 의심 {duplicateCount}건</span>}
            <span style={{ display: 'block', marginTop: 5, color: 'var(--text-3)', fontSize: 12 }}>{new Date(result.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 확인</span>
          </>}
        </div>
        {!loading && !error && <div style={{ maxHeight: '52vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
          <table className="table" style={{ width: '100%' }}>
            <thead><tr><th>휴가</th><th>기간</th><th>상태</th></tr></thead>
            <tbody>
              {visible.map((event) => <tr key={`${event.id}:${event.start}`}>
                <td><strong>{event.title}</strong>{event.description && <details style={{ marginTop: 6, color: 'var(--text-3)', fontSize: 12 }}><summary style={{ cursor: 'pointer' }}>설명 보기</summary><div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{event.description}</div></details>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{event.start.slice(0, 10)}{event.end && event.end !== event.start.slice(0, 10) ? ` ~ ${event.end}` : ''}</td>
                <td><span className={`badge ${event.duplicate ? 'red' : 'green'}`}>{event.duplicate ? '중복 의심' : '등록됨'}</span></td>
              </tr>)}
              {visible.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 28, color: 'var(--text-3)' }}>{events.length ? '검색 결과가 없습니다.' : '이 달에 등록된 일정이 없습니다.'}</td></tr>}
            </tbody>
          </table>
        </div>}
      </div>
    </dialog>
  );
}
