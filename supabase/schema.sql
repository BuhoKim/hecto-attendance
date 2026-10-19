-- ================================================================
-- Hecto 근태 시스템 - Supabase 스키마
-- 테이블 prefix: SA_ (Secom Attendance)
-- ================================================================

-- ----------------------------------------------------------------
-- 동기화 테이블 (서버PC 데몬 → Supabase, 읽기전용)
-- ----------------------------------------------------------------

-- SA_employees: hr_employee 복사본
CREATE TABLE IF NOT EXISTS SA_employees (
  emp_no       VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  dept         VARCHAR(100),
  email        TEXT,
  login_id     TEXT,
  company_code VARCHAR(10) DEFAULT '1600',
  is_active    BOOLEAN DEFAULT TRUE,
  synced_at    TIMESTAMPTZ DEFAULT NOW()
);

-- SA_attendance: t_secom_alarm 복사본
CREATE TABLE IF NOT EXISTS SA_attendance (
  id         BIGSERIAL PRIMARY KEY,
  sabun      VARCHAR(50),
  emp_no     VARCHAR(20),
  card_no    VARCHAR(20),
  a_time     VARCHAR(14) NOT NULL,     -- 원본 YYYYMMDDHHMMSS
  log_time   TIMESTAMPTZ,              -- 파싱된 시간
  eq_code    VARCHAR(10),
  gate_name  VARCHAR(100),
  flag1      VARCHAR(4),               -- '1'=출근, '4'=퇴근
  event_type VARCHAR(10),              -- 출근/퇴근/출입
  source     VARCHAR(20),              -- secom/caps
  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sabun, a_time)
);

-- SA_leaves: hr_yuncha_use 복사본
CREATE TABLE IF NOT EXISTS SA_leaves (
  id          BIGSERIAL PRIMARY KEY,
  emp_no      VARCHAR(20) NOT NULL,
  emp_name    VARCHAR(100),
  start_date  VARCHAR(8) NOT NULL,     -- YYYYMMDD
  end_date    VARCHAR(8) NOT NULL,
  leave_code  VARCHAR(10),
  leave_name  VARCHAR(100),
  leave_days  DECIMAL(5,3),
  status      VARCHAR(5),
  synced_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (emp_no, start_date, leave_code)
);

-- SA_leave_backfill_queue: 신규 등록 사번 연차 보강 요청 큐
CREATE TABLE IF NOT EXISTS SA_leave_backfill_queue (
  emp_no       VARCHAR(20) PRIMARY KEY,
  status       VARCHAR(20) DEFAULT 'pending',
  requested_by UUID REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error   TEXT,
  synced_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- 신규 데이터 테이블
-- ----------------------------------------------------------------

-- SA_profiles: Supabase Auth ↔ 직원 연결 + 권한
CREATE TABLE IF NOT EXISTS SA_profiles (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  emp_no               VARCHAR(20) REFERENCES SA_employees(emp_no),
  dept                 VARCHAR(100),
  rank                 VARCHAR(50),  -- 직급 (예: 대리, 과장 등)
  position             VARCHAR(50),  -- 직책 (예: 팀장, 실장 등)
  is_admin             BOOLEAN DEFAULT FALSE,
  must_change_password BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- SA_overtime_settings: 팀별 초과시간 설정 (관리자가 수정 가능)
CREATE TABLE IF NOT EXISTS SA_overtime_settings (
  id               BIGSERIAL PRIMARY KEY,
  dept_name        VARCHAR(100) NOT NULL UNIQUE,  -- 팀 이름 정확히 일치
  threshold_time   TIME NOT NULL DEFAULT '19:00:00',
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 초기 초과시간 적용 팀 등록
INSERT INTO SA_overtime_settings (dept_name, threshold_time) VALUES
  ('사업관리 1팀', '19:00:00'),
  ('사업관리 2팀', '19:00:00'),
  ('사업관리 3팀', '19:00:00'),
  ('사업개발팀',   '19:00:00')
ON CONFLICT (dept_name) DO NOTHING;

-- SA_overtime_periods: 초과시간 관리 기간 정의
CREATE TABLE IF NOT EXISTS SA_overtime_periods (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(100),             -- 예: '2026년 1분기'
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  note        TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- SA_attendance_corrections: 퇴근시간 수정/보정 (관리자)
CREATE TABLE IF NOT EXISTS SA_attendance_corrections (
  id                 BIGSERIAL PRIMARY KEY,
  emp_no             VARCHAR(20) NOT NULL,
  work_date          DATE NOT NULL,
  corrected_out_time TIMESTAMPTZ NOT NULL,
  reason             TEXT,
  corrected_by       UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (emp_no, work_date)
);

-- SA_schedule_overrides: 날짜별 근무일정 조정 (관리자)
CREATE TABLE IF NOT EXISTS SA_schedule_overrides (
  id             BIGSERIAL PRIMARY KEY,
  emp_no         VARCHAR(20) NOT NULL,
  work_date      DATE NOT NULL,
  schedule_start TIME,                 -- 해당 날짜 출근 기준시간
  schedule_end   TIME,                 -- 해당 날짜 퇴근 기준시간
  allow_overtime BOOLEAN NOT NULL DEFAULT TRUE,
  note           TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (emp_no, work_date)
);

CREATE TABLE IF NOT EXISTS SA_attendance_log_adjustments (
  id             BIGSERIAL PRIMARY KEY,
  attendance_id  BIGINT NOT NULL REFERENCES SA_attendance(id) ON DELETE CASCADE,
  emp_no         VARCHAR(20) NOT NULL,
  work_date      DATE NOT NULL,
  adjusted_role  VARCHAR(10) NOT NULL CHECK (adjusted_role IN ('출근', '퇴근', '무시하기')),
  note           TEXT,
  adjusted_by    UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (attendance_id)
);
CREATE TABLE IF NOT EXISTS SA_employee_schedules (
  emp_no        VARCHAR(20) PRIMARY KEY REFERENCES SA_employees(emp_no) ON DELETE CASCADE,
  schedule_time TIME NOT NULL DEFAULT '08:00:00',
  schedule_end_time TIME,
  updated_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS SA_team_schedule_patterns (
  id             BIGSERIAL PRIMARY KEY,
  dept_name      VARCHAR(100) NOT NULL,
  work_date      DATE NOT NULL,
  pattern_code   VARCHAR(20) NOT NULL,
  pattern_name   VARCHAR(100) NOT NULL,
  schedule_start TIME,
  schedule_end   TIME,
  note           TEXT,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dept_name, work_date)
);

-- SA_holiday_work: 휴일근무 → 대체휴가
CREATE TABLE IF NOT EXISTS SA_holiday_work (
  id                BIGSERIAL PRIMARY KEY,
  emp_no            VARCHAR(20) NOT NULL,
  work_date         DATE NOT NULL,
  clock_in          TIMESTAMPTZ,
  clock_out         TIMESTAMPTZ,
  work_hours        DECIMAL(5,2),
  comp_leave_hours  DECIMAL(5,2),      -- 부여 대체휴가 시간
  is_confirmed      BOOLEAN DEFAULT FALSE,
  confirmed_by      UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (emp_no, work_date)
);

-- SA_manual_checkins: 직원 자가 출퇴근 기록
CREATE TABLE IF NOT EXISTS SA_manual_checkins (
  id             BIGSERIAL PRIMARY KEY,
  emp_no         VARCHAR(20) NOT NULL,
  check_type     VARCHAR(10) NOT NULL,  -- '출근' | '퇴근'
  check_time     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  work_date      DATE NOT NULL,
  note           TEXT,
  admin_decision VARCHAR(20),           -- NULL | 'approved' | 'rejected'
  decided_by     UUID REFERENCES auth.users(id),
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS SA_ical_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  label       VARCHAR(200) NOT NULL,
  depts       JSONB NOT NULL DEFAULT '[]'::jsonb,
    scope       VARCHAR(50) NOT NULL DEFAULT 'leave-calendar',
    owner_emp_no VARCHAR(20),
    calendar_config JSONB,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

-- ----------------------------------------------------------------
-- Row Level Security (RLS)
-- ----------------------------------------------------------------

ALTER TABLE SA_employees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_attendance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_leaves               ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_leave_backfill_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_overtime_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_overtime_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_attendance_log_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_schedule_overrides   ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_employee_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_team_schedule_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_holiday_work         ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_manual_checkins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE SA_ical_subscriptions   ENABLE ROW LEVEL SECURITY;

-- 헬퍼 함수: 현재 로그인 사용자가 관리자인지 확인
CREATE OR REPLACE FUNCTION SA_is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM SA_profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- 헬퍼 함수: 현재 로그인 사용자가 팀장(직책)인지 확인
CREATE OR REPLACE FUNCTION SA_is_leader()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT position = '팀장' FROM SA_profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- 헬퍼 함수: 현재 로그인 사용자의 emp_no 반환
CREATE OR REPLACE FUNCTION SA_my_emp_no()
RETURNS VARCHAR AS $$
  SELECT emp_no FROM SA_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- SA_employees: 관리자/팀장=전체, 직원=본인
CREATE POLICY "sa_employees_admin"    ON SA_employees FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_employees_self"     ON SA_employees FOR SELECT USING (emp_no = SA_my_emp_no());

-- SA_attendance: 관리자/팀장=전체, 직원=본인
CREATE POLICY "sa_attendance_admin"   ON SA_attendance FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_attendance_self"    ON SA_attendance FOR SELECT USING (emp_no = SA_my_emp_no());

-- SA_leaves: 관리자/팀장=전체, 직원=본인
CREATE POLICY "sa_leaves_admin"       ON SA_leaves FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_leaves_self"        ON SA_leaves FOR SELECT USING (emp_no = SA_my_emp_no());

-- SA_profiles: 관리자=전체, 팀장=조회, 직원=본인만 조회/수정
CREATE POLICY "sa_profiles_admin"     ON SA_profiles FOR ALL    USING (SA_is_admin());
CREATE POLICY "sa_profiles_leader"    ON SA_profiles FOR SELECT USING (SA_is_leader());
CREATE POLICY "sa_profiles_self"      ON SA_profiles FOR SELECT USING (id = auth.uid());
CREATE OR REPLACE FUNCTION public.sa_profile_auth_unchanged(
  old_emp_no varchar, old_is_admin boolean, old_position text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sa_profiles
    WHERE id = auth.uid() AND emp_no = old_emp_no
      AND is_admin = old_is_admin AND position = old_position
  );
$$;
REVOKE ALL ON FUNCTION public.sa_profile_auth_unchanged(varchar, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sa_profile_auth_unchanged(varchar, boolean, text) TO authenticated;
CREATE POLICY "sa_profiles_self_upd" ON SA_profiles FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND public.sa_profile_auth_unchanged(emp_no, is_admin, position));

-- SA_overtime_settings: 관리자=전체, 직원=조회만
CREATE POLICY "sa_ot_settings_admin"  ON SA_overtime_settings FOR ALL    USING (SA_is_admin());
CREATE POLICY "sa_ot_settings_read"   ON SA_overtime_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- SA_overtime_periods: 관리자=전체, 직원=조회만
CREATE POLICY "sa_ot_periods_admin"   ON SA_overtime_periods FOR ALL    USING (SA_is_admin());
CREATE POLICY "sa_ot_periods_read"    ON SA_overtime_periods FOR SELECT USING (auth.uid() IS NOT NULL);

-- SA_attendance_corrections: 관리자/팀장=전체, 직원=본인 조회
CREATE POLICY "sa_corrections_admin"  ON SA_attendance_corrections FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_corrections_self"   ON SA_attendance_corrections FOR SELECT USING (emp_no = SA_my_emp_no());

CREATE POLICY "sa_attendance_log_adjustments_admin" ON SA_attendance_log_adjustments FOR ALL USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_attendance_log_adjustments_self" ON SA_attendance_log_adjustments FOR SELECT USING (emp_no = SA_my_emp_no());

-- SA_schedule_overrides: 관리자/팀장=전체, 직원=본인 조회
CREATE POLICY "sa_schedules_admin"    ON SA_schedule_overrides FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_schedules_self"     ON SA_schedule_overrides FOR SELECT USING (emp_no = SA_my_emp_no());
CREATE POLICY "sa_employee_schedules_admin" ON SA_employee_schedules FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_employee_schedules_self"  ON SA_employee_schedules FOR SELECT USING (emp_no = SA_my_emp_no());

CREATE POLICY "sa_team_schedule_patterns_admin" ON SA_team_schedule_patterns FOR ALL USING (SA_is_admin() OR SA_is_leader());

-- SA_holiday_work: 관리자/팀장=전체, 직원=본인 조회
CREATE POLICY "sa_holiday_admin"      ON SA_holiday_work FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_holiday_self"       ON SA_holiday_work FOR SELECT USING (emp_no = SA_my_emp_no());

-- SA_manual_checkins: 관리자/팀장=전체, 직원=본인 조회/입력
CREATE POLICY "sa_manual_admin"       ON SA_manual_checkins FOR ALL    USING (SA_is_admin() OR SA_is_leader());
CREATE POLICY "sa_manual_self_read"   ON SA_manual_checkins FOR SELECT USING (emp_no = SA_my_emp_no());
CREATE POLICY "sa_manual_self_insert" ON SA_manual_checkins FOR INSERT WITH CHECK (emp_no = SA_my_emp_no());
CREATE POLICY "sa_ical_subscriptions_admin" ON SA_ical_subscriptions FOR ALL USING (SA_is_admin()) WITH CHECK (SA_is_admin());

-- SA_taxi_explanations: 서버의 서명 토큰 API만 service_role로 접근
-- anon/authenticated에는 정책을 부여하지 않아 직접 조회·수정을 차단한다.

-- ----------------------------------------------------------------
-- 인덱스
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- SA_taxi_explanations: 야간 택시 이용 소명 내역
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS SA_taxi_explanations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token            VARCHAR(100) UNIQUE NOT NULL,
  order_id         VARCHAR(100),
  ticket_no        VARCHAR(100),
  emp_no           VARCHAR(50),
  employee_name    VARCHAR(100),
  dept             VARCHAR(100),
  ride_time        VARCHAR(100),
  actual_out_time  VARCHAR(100),
  amount           NUMERIC,
  pickup           TEXT,
  dropoff          TEXT,
  use_reason       TEXT,
  explanation_text TEXT,
  status           VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, SUBMITTED, APPROVED, REJECTED
  requested_at     TIMESTAMPTZ DEFAULT NOW(),
  submitted_at     TIMESTAMPTZ,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE SA_taxi_explanations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sa_attendance_emp_no   ON SA_attendance (emp_no);
CREATE INDEX IF NOT EXISTS idx_sa_attendance_log_time ON SA_attendance (log_time DESC);
CREATE INDEX IF NOT EXISTS idx_sa_attendance_a_time   ON SA_attendance (a_time DESC);
CREATE INDEX IF NOT EXISTS idx_sa_leaves_emp_no       ON SA_leaves (emp_no);
CREATE INDEX IF NOT EXISTS idx_sa_leaves_dates        ON SA_leaves (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_sa_leave_queue_status  ON SA_leave_backfill_queue (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_sa_employee_schedules_updated ON SA_employee_schedules (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_team_schedule_patterns_dept_date ON SA_team_schedule_patterns (dept_name, work_date);
CREATE INDEX IF NOT EXISTS idx_sa_manual_emp_date     ON SA_manual_checkins (emp_no, work_date);
CREATE INDEX IF NOT EXISTS idx_sa_corrections_emp     ON SA_attendance_corrections (emp_no, work_date);
CREATE INDEX IF NOT EXISTS idx_sa_attendance_log_adjustments_emp_date ON SA_attendance_log_adjustments (emp_no, work_date);
CREATE INDEX IF NOT EXISTS idx_sa_attendance_log_adjustments_attendance ON SA_attendance_log_adjustments (attendance_id);
CREATE INDEX IF NOT EXISTS idx_sa_ical_subscriptions_created_at ON SA_ical_subscriptions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_ical_subscriptions_active ON SA_ical_subscriptions (is_active, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sa_taxi_explanations_token ON SA_taxi_explanations (token);
CREATE INDEX IF NOT EXISTS idx_sa_taxi_explanations_emp   ON SA_taxi_explanations (emp_no, status);
CREATE INDEX IF NOT EXISTS idx_sa_taxi_explanations_order ON SA_taxi_explanations (order_id);
