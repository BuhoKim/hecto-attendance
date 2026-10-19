-- Existing iCal subscriptions and legacy member exclusions remain compatible.
ALTER TABLE public.sa_ical_subscriptions
  ADD COLUMN IF NOT EXISTS calendar_config jsonb;

COMMENT ON COLUMN public.sa_ical_subscriptions.calendar_config IS
  'NAVER WORKS member choices: excludedEmpNos and explicitly includedConcurrentEmpNos. NULL uses legacy owner_emp_no exclusions.';
