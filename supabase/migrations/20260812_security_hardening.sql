-- Security hardening: keep sensitive taxi explanations server-only.
ALTER TABLE public.sa_taxi_explanations ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers must use a fixed schema resolution path.
ALTER FUNCTION public.sa_is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.sa_is_leader() SET search_path = public, pg_temp;
ALTER FUNCTION public.sa_my_emp_no() SET search_path = public, pg_temp;

-- This RPC is not used by the application (the server uses service_role directly).
-- Prevent anonymous/authenticated callers from invoking a broad attendance export.
REVOKE EXECUTE ON FUNCTION public.get_attendance_logs_json(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_logs_json(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_attendance_logs_json(
  log_time_from text,
  log_time_to text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT jsonb_agg(t)
    FROM (
      SELECT
        id,
        emp_no,
        card_no,
        a_time,
        log_time,
        gate_name,
        flag1,
        event_type,
        source
      FROM public.sa_attendance
      WHERE log_time >= log_time_from::timestamptz
        AND log_time <= log_time_to::timestamptz
      ORDER BY log_time DESC
    ) t
  ), '[]'::jsonb);
$$;

REVOKE EXECUTE ON FUNCTION public.get_attendance_logs_json(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_logs_json(text, text) TO service_role;
