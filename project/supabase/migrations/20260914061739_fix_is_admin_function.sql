/*
# Fix is_admin() and current_user_role() functions

## Problem
The original is_admin() and current_user_role() functions checked `raw_app_meta_data` in the JWT,
which is not automatically set by Supabase auth when users sign up. This means all RLS policies
using is_admin() would return false for everyone, blocking all writes.

## Fix
Changed both functions to query the `profiles` table directly using `auth.uid()` to get the
current user's role. This works because:
1. The `handle_new_user()` trigger creates a profile row on signup
2. The profiles table has a SELECT policy allowing all authenticated users to read
3. The function is SECURITY DEFINER so it bypasses RLS on profiles

## Changes
- `current_user_role()` now queries profiles table instead of JWT
- `is_admin()` uses the updated `current_user_role()` function
*/

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(public.current_user_role(), '') = 'admin';
$$;