ALTER TABLE public.sa_ical_subscriptions
  ADD COLUMN IF NOT EXISTS owner_emp_no VARCHAR(20);
