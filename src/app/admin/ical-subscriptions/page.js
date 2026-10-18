'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Copy, Link2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import EmployeeAdminShell from '../employees/EmployeeAdminShell';
import styles from './subscriptions.module.css';

const DEFAULT_DEPTS = ['경영지원실', '경영지원팀'];

function Action({ children, primary, danger, ...props }) {
  return <button type="button" className={`tab-btn ${styles.button} ${primary ? styles.primary : ''} ${danger ? styles.danger : ''}`} {...props}>{children}</button>;
}

function Departments({ departments, selected, onChange, disabled }) {
  return <div className={styles.departments}>
    {departments.map(dept => <label key={dept} className={styles.department} data-checked={selected.includes(dept)}>
      <input type="checkbox" checked={selected.includes(dept)} disabled={disabled}
        onChange={e => onChange(e.target.checked ? [...selected, dept] : selected.filter(value => value !== dept))} />
      {dept}
    </label>)}
  </div>;
}

function SubscriptionRow({ item, departments, employees, onCopyUrl, onCopyWebcal, onToggleActive, onDelete, onUpdateDepts }) {
  const [panel, setPanel] = useState(null);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const choices = [...new Set([...departments, ...(item.depts || [])])];
  const owner = employees.find((employee) => String(employee.empNo) === String(item.ownerEmpNo));
  const displayLabel = owner
    ? `${owner.name} 개인용 캘린더`
    : (item.label && item.label !== '캘린더 링크' ? item.label : ((item.depts || []).length === 1 ? `${item.depts[0]} 캘린더 링크` : item.label || '캘린더 링크'));
  const save = async () => {
    setSaving(true);
    setFailure('');
    try { await onUpdateDepts(draft); setPanel(null); }
    catch (error) { setFailure(error.message); }
    finally { setSaving(false); }
  };
  return <Fragment>
    <tr className={styles.row} data-open={Boolean(panel)} data-active={item.isActive}>
      <td><div className={styles.nameCell}><CalendarDays size={15} aria-hidden="true" /><span className={styles.name} title={displayLabel}>{displayLabel}</span></div></td>
      <td><span className={styles.deptSummary} title={(item.depts || []).join(', ')}>{(item.depts || []).join(' · ') || '-'}</span></td>
      <td><span className={styles.status} data-active={item.isActive}>{item.isActive ? '활성' : '비활성'}</span></td>
      <td><div className={styles.actions}>
        <Action onClick={onCopyUrl} title="구독 URL 복사"><Copy size={13} />복사</Action>
        <Action aria-expanded={panel === 'edit'} disabled={saving} onClick={() => { setDraft(item.depts || []); setFailure(''); setPanel(panel === 'edit' ? null : 'edit'); }}><Pencil size={13} />편집</Action>
        <Action aria-expanded={panel === 'detail'} disabled={saving} onClick={() => setPanel(panel === 'detail' ? null : 'detail')}><ChevronDown size={13} />상세</Action>
      </div></td>
    </tr>
    {panel && <tr className={styles.expanded}><td colSpan={4}>
      {panel === 'edit' ? <div className={styles.editor}>
        <div className={styles.toolbar}><strong>부서 편집 <span className={styles.muted}>· {draft.length}개 선택</span></strong>
          <div className={styles.actions}><Action disabled={saving} onClick={() => setPanel(null)}>취소</Action>
            <Action primary disabled={saving || !draft.length} onClick={save}><Check size={13} />{saving ? '저장 중' : '저장'}</Action></div>
        </div>
        <Departments departments={choices} selected={draft} onChange={setDraft} disabled={saving} />
        {failure && <p role="alert" className={styles.error}>{failure}</p>}
        <span className={styles.muted}>기존 링크가 유지되며 다음 캘린더 동기화에 반영됩니다.</span>
      </div> : <div className={styles.details}>
        {[[item.url, 'URL', onCopyUrl], [item.webcalUrl, 'webcal', onCopyWebcal]].map(([url, label, copy]) =>
          <div className={styles.linkLine} key={label}><span>{label}</span><input aria-label={label} readOnly value={url || ''} onFocus={e => e.target.select()} /><Action onClick={copy} aria-label={label + ' 복사'}><Copy size={13} /></Action></div>)}
        <div className={styles.toolbar}><span className={styles.muted}>생성 {item.createdAt ? new Date(item.createdAt).toLocaleDateString('ko-KR') : '-'}</span>
          <div className={styles.actions}><Action onClick={() => onToggleActive(item.isActive)}>{item.isActive ? '비활성화' : '활성화'}</Action><Action danger onClick={onDelete}><Trash2 size={13} />삭제</Action></div></div>
      </div>}
    </td></tr>}
  </Fragment>;
}

export default function IcalSubscriptionPage() {
  const [employees, setEmployees] = useState([]);
  const [selectedDepts, setSelectedDepts] = useState(DEFAULT_DEPTS);
  const [personalLink, setPersonalLink] = useState(false);
  const [personalOwnerEmpNo, setPersonalOwnerEmpNo] = useState('');
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [reloadNotice, setReloadNotice] = useState('');
  const copyNoticeTimer = useRef(null);
  const reloadNoticeTimer = useRef(null);

  const employeeDepartments = useMemo(() => {
    return Array.from(
      new Set(
        (employees || [])
          .map((employee) => String(employee.dept || '').trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [employees]);

  const effectiveSelectedDepts = useMemo(() => {
    if (employeeDepartments.length === 0 || selectedDepts.length === 0) return selectedDepts;
    const filtered = selectedDepts.filter((dept) => employeeDepartments.includes(dept));
    return filtered.length > 0 ? filtered : employeeDepartments.slice(0, 2);
  }, [employeeDepartments, selectedDepts]);

  const selectedCount = effectiveSelectedDepts.length;
  const activeCount = subscriptions.filter((item) => item.isActive).length;
  const selectedPersonalEmployee = employees.find((employee) => String(employee.empNo) === String(personalOwnerEmpNo));
  const personalLabel = selectedPersonalEmployee ? `${selectedPersonalEmployee.name} 개인용 캘린더` : '개인용 캘린더';

  const autoLabel = useMemo(() => {
    if (effectiveSelectedDepts.length === 0) return '캘린더 링크';
    if (effectiveSelectedDepts.length === 1) return `${effectiveSelectedDepts[0]} 캘린더 링크`;
    return `${effectiveSelectedDepts[0]} 외 ${effectiveSelectedDepts.length - 1}개 부서 캘린더 링크`;
  }, [effectiveSelectedDepts]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingEmployees(true);
        const res = await fetch('/api/admin/employees', { credentials: 'include' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '직원 목록을 불러오지 못했습니다.');
        if (!alive) return;
        setEmployees(json.employees || []);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoadingEmployees(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingSubscriptions(true);
        const res = await fetch('/api/ical/subscriptions', { credentials: 'include' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '구독 목록을 불러오지 못했습니다.');
        if (!alive) return;
        setSubscriptions(json.subscriptions || []);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoadingSubscriptions(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);


  const refreshSubscriptions = async () => {
    const res = await fetch('/api/ical/subscriptions', { credentials: 'include' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || '구독 목록을 다시 불러오지 못했습니다.');
    setSubscriptions(json.subscriptions || []);
  };

  const refreshSubscriptionsWithNotice = async () => {
    await refreshSubscriptions();
    setReloadNotice('구독 목록을 새로고침했습니다.');
    if (reloadNoticeTimer.current) {
      window.clearTimeout(reloadNoticeTimer.current);
    }
    reloadNoticeTimer.current = window.setTimeout(() => {
      setReloadNotice('');
      reloadNoticeTimer.current = null;
    }, 1800);
  };

  const createSubscription = async () => {
    setCreating(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/ical/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          depts: effectiveSelectedDepts,
          label: personalLink ? personalLabel : autoLabel,
          personal: personalLink,
          ownerEmpNo: personalOwnerEmpNo,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '구독 URL 생성에 실패했습니다.');

      setMessage('구독 링크를 생성했습니다.');
      await refreshSubscriptions();
      setShowCreate(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const setActive = async (token, active) => {
    try {
      const res = await fetch(`/api/ical/subscriptions/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '상태 변경에 실패했습니다.');
      await refreshSubscriptions();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateSubscriptionDepartments = async (token, depts) => {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/ical/subscriptions/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ depts }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '부서 범위 저장에 실패했습니다.');
      await refreshSubscriptions();
      setMessage('기존 캘린더 링크의 부서 범위를 변경했습니다.');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteSubscription = async (token, labelText) => {
    const confirmed = window.confirm(`"${labelText}" 구독을 완전히 삭제할까요?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/ical/subscriptions/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '삭제에 실패했습니다.');
      await refreshSubscriptions();
    } catch (err) {
      setError(err.message);
    }
  };

  const copy = async (value, label) => {
    if (!value) return;
    await navigator.clipboard?.writeText?.(value);
    setCopyNotice(`${label}가 복사되었습니다.`);
    if (copyNoticeTimer.current) {
      window.clearTimeout(copyNoticeTimer.current);
    }
    copyNoticeTimer.current = window.setTimeout(() => {
      setCopyNotice('');
      copyNoticeTimer.current = null;
    }, 1800);
  };

  return (
    <EmployeeAdminShell title="캘린더 링크 생성" subtitle="구독 링크와 부서 범위를 관리합니다." activeHref="/admin/ical-subscriptions">
      <section className={styles.page}>
        <div className={styles.toolbar}>
          <div className={styles.heading}><h2>구독 목록</h2><span className={styles.count}>{subscriptions.length}</span><span className={styles.activeCount}>활성 {activeCount}</span></div>
          <div className={styles.actions}>
            <Action disabled={loadingSubscriptions} onClick={() => refreshSubscriptionsWithNotice().catch(err => setError(err.message))}><RefreshCw size={14} />새로고침</Action>
            <Action primary aria-expanded={showCreate} onClick={() => setShowCreate(!showCreate)}>{showCreate ? <X size={14} /> : <Plus size={14} />}{showCreate ? '닫기' : '새 링크'}</Action>
          </div>
        </div>
        {showCreate && <div className={styles.create}>
          <div className={styles.toolbar}><strong>부서 선택 <span className={styles.muted}>· {selectedCount}개</span></strong>
            <div className={styles.actions}><Action disabled={loadingEmployees} onClick={() => setSelectedDepts(employeeDepartments)}>전체 선택</Action><Action onClick={() => setSelectedDepts([])}>해제</Action></div>
          </div>
          {loadingEmployees ? <p className={styles.muted}>부서를 불러오는 중...</p> : employeeDepartments.length === 0 ? <p className={styles.muted}>선택할 부서가 없습니다.</p> :
            <Departments departments={employeeDepartments} selected={effectiveSelectedDepts} onChange={setSelectedDepts} disabled={creating} />}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', fontSize: 13 }}><input type="checkbox" checked={personalLink} onChange={e => setPersonalLink(e.target.checked)} disabled={creating} />개인용 링크 (선택 직원의 현재 소속팀 자동 반영)</label>
          {personalLink && <select className="ui-input" style={{ maxWidth: 280, marginBottom: 12 }} value={personalOwnerEmpNo} onChange={e => setPersonalOwnerEmpNo(e.target.value)} disabled={creating}><option value="">직원 선택</option>{employees.filter(e => e.isActive !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko')).map(e => <option key={e.empNo} value={e.empNo}>{e.name} · {e.dept}</option>)}</select>}
          <div className={styles.toolbar}><span className={styles.muted}>이름: {personalLink ? personalLabel : autoLabel}</span>
            <Action primary onClick={createSubscription} disabled={creating || loadingEmployees || !employeeDepartments.length || (personalLink ? !personalOwnerEmpNo : selectedCount === 0)}><Link2 size={14} />{creating ? '생성 중' : '링크 생성'}</Action></div>
        </div>}
        {(error || message || copyNotice || reloadNotice) && <div role={error ? 'alert' : 'status'} className={error ? styles.error : styles.notice}>{error || copyNotice || reloadNotice || message}</div>}
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-label="캘린더 구독 목록">
            <colgroup><col style={{ width: '30%' }} /><col /><col style={{ width: 74 }} /><col style={{ width: 202 }} /></colgroup>
            <thead><tr><th scope="col">링크명</th><th scope="col">구독 부서</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead>
            <tbody>
              {loadingSubscriptions || !subscriptions.length ? <tr><td colSpan={4} className={styles.empty}>{loadingSubscriptions ? '구독 목록을 불러오는 중...' : '등록된 구독이 없습니다. 새 링크를 생성해 주세요.'}</td></tr> :
                subscriptions.map(item => <SubscriptionRow key={item.id} item={item} departments={employeeDepartments} employees={employees}
                  onCopyUrl={() => copy(item.url, 'URL').catch(err => setError(err.message))}
                  onCopyWebcal={() => copy(item.webcalUrl, 'webcal URL').catch(err => setError(err.message))}
                  onToggleActive={active => setActive(item.token, !active)}
                  onDelete={() => deleteSubscription(item.token, item.label)}
                  onUpdateDepts={depts => updateSubscriptionDepartments(item.token, depts)} />)}
            </tbody>
          </table>
        </div>
      </section>
    </EmployeeAdminShell>
  );
}
