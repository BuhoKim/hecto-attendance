-- hr_employee 재직상태(I_STATE_CODE)·적용일자(D_STATE_DATE) 반영
-- 001 재직 / 002 휴직 / 999 퇴직
ALTER TABLE public.sa_employees
  ADD COLUMN IF NOT EXISTS hr_state_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS hr_state_date DATE;

CREATE INDEX IF NOT EXISTS sa_employees_hr_state_code_idx
  ON public.sa_employees (hr_state_code);
