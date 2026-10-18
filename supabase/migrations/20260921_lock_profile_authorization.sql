-- Prevent clients from changing authorization-bearing profile columns.
-- The application updates profiles through the service-role API after checking
-- the authenticated session; direct Supabase clients may only edit display rank.
CREATE OR REPLACE FUNCTION public.sa_profile_auth_unchanged(
  old_emp_no varchar,
  old_is_admin boolean,
  old_position text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sa_profiles
    WHERE id = auth.uid()
      AND emp_no = old_emp_no
      AND is_admin = old_is_admin
      AND position = old_position
  );
$$;

REVOKE ALL ON FUNCTION public.sa_profile_auth_unchanged(varchar, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sa_profile_auth_unchanged(varchar, boolean, text) TO authenticated;

DROP POLICY IF EXISTS "sa_profiles_self_upd" ON public.sa_profiles;

CREATE POLICY "sa_profiles_self_upd" ON public.sa_profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND public.sa_profile_auth_unchanged(emp_no, is_admin, position)
  );
