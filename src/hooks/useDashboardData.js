'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getNextRefreshDelay, INITIAL_REFRESH_DELAY_MS } from '../lib/refreshSchedule.mjs';
import { createDashboardRequestCache } from '../lib/dashboardRequestCache.mjs';

const MONTHLY_TABS = new Set(['MONTHLY', 'TRACKER', 'MY_PORTAL', 'LEAVES', 'EMPLOYEES', 'OVERTIME', 'MANUAL_APPROVAL', 'USER_REGISTER']);
const singleEmployeeTab = tab => tab === 'TRACKER' || tab === 'MY_PORTAL';
const reportFailure = error => {
  if (error?.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('session-expired'));
  }
  console.error('Dashboard data request failed:', error);
};

export function useDashboardData({ activeTab, selectedEmployee, setSelectedEmployee, myEmpNo, isAdmin, selectedMonth, calendarMonth }) {
  const [cache] = useState(() => createDashboardRequestCache());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthlyData, setMonthlyData] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [calendarLeaves, setCalendarLeaves] = useState([]);
  const todayRequest = useRef(0);
  const monthlyRequest = useRef(0);
  const calendarRequest = useRef(0);

  const fetchTodayData = useCallback(async (silent = false) => {
    const requestId = ++todayRequest.current;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const json = await cache.get('/api/attendance', { force: true });
      if (requestId !== todayRequest.current) return false;
      setData(json);
      if (json.allEmployees?.length) {
        setSelectedEmployee(previous => previous || (isAdmin ? json.allEmployees[0].empNo : myEmpNo));
      }
      return true;
    } catch (error) { reportFailure(error); return false; }
    finally {
      if (requestId === todayRequest.current) { setLoading(false); setRefreshing(false); }
    }
  }, [cache, isAdmin, myEmpNo, setSelectedEmployee]);

  const fetchMonthlyData = useCallback(async (month, empNo) => {
    if (!month) return true;
    const requestId = ++monthlyRequest.current;
    setMonthlyLoading(true);
    setMonthlyData(null);
    const params = new URLSearchParams({ month });
    if (empNo) params.set('empNo', empNo);
    try {
      const json = await cache.get('/api/attendance?' + params);
      if (requestId === monthlyRequest.current) setMonthlyData(json);
      return true;
    } catch (error) { reportFailure(error); return false; }
    finally { if (requestId === monthlyRequest.current) setMonthlyLoading(false); }
  }, [cache]);

  const fetchCalendarLeaves = useCallback(async month => {
    if (!month) return true;
    const requestId = ++calendarRequest.current;
    setCalendarLeaves([]);
    try {
      const params = new URLSearchParams({ month, excludeLogs: 'true' });
      const json = await cache.get('/api/attendance?' + params);
      if (requestId === calendarRequest.current) setCalendarLeaves(json.leaves || []);
      return true;
    } catch (error) { reportFailure(error); return false; }
  }, [cache]);

  const empNoFilter = singleEmployeeTab(activeTab) ? (selectedEmployee || myEmpNo) : null;
  const needsMonthlyData = MONTHLY_TABS.has(activeTab) && (!singleEmployeeTab(activeTab) || !!empNoFilter);

  const refreshAllData = useCallback(async () => {
    cache.clear();
    const results = await Promise.all([
      fetchTodayData(true),
      needsMonthlyData ? fetchMonthlyData(selectedMonth, empNoFilter) : true,
      fetchCalendarLeaves(calendarMonth),
    ]);
    return results.every(Boolean);
  }, [cache, calendarMonth, empNoFilter, fetchCalendarLeaves, fetchMonthlyData, fetchTodayData, needsMonthlyData, selectedMonth]);

  // Mutations can affect neighboring calendar cells and multiple cached employee
  // views. Revalidate the active view instead of merging into an unrelated scope.
  const refreshEmployeeData = useCallback(async () => refreshAllData(), [refreshAllData]);

  useEffect(() => {
    void fetchTodayData();
    return () => { todayRequest.current++; };
  }, [fetchTodayData]);

  useEffect(() => {
    if (needsMonthlyData) void fetchMonthlyData(selectedMonth, empNoFilter);
    return () => { monthlyRequest.current++; };
  }, [empNoFilter, fetchMonthlyData, needsMonthlyData, selectedMonth]);

  useEffect(() => {
    void fetchCalendarLeaves(calendarMonth);
    return () => { calendarRequest.current++; };
  }, [calendarMonth, fetchCalendarLeaves]);

  useEffect(() => {
    let cancelled = false;
    let delay = INITIAL_REFRESH_DELAY_MS;
    let timeoutId;
    const schedule = () => {
      if (cancelled) return;
      timeoutId = setTimeout(async () => {
        const succeeded = await refreshAllData();
        delay = getNextRefreshDelay(succeeded, delay);
        schedule();
      }, delay);
    };
    schedule();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshAllData();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshAllData]);

  return { data, loading, refreshing, monthlyData, monthlyLoading, calendarLeaves, fetchTodayData, refreshAllData, refreshEmployeeData };
}
