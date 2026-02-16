
-- Role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- RLS for user_roles: only admins
CREATE POLICY "Admins can view roles" ON public.user_roles
  FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE USING (public.is_admin(auth.uid()));

-- Calculation logs table
CREATE TABLE public.calculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  module TEXT NOT NULL DEFAULT 'cementing',
  well_data JSONB,
  calc_params JSONB,
  ip_address TEXT,
  user_agent TEXT,
  page_url TEXT
);
ALTER TABLE public.calculation_logs ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT logs (anonymous calculations)
CREATE POLICY "Anyone can insert logs" ON public.calculation_logs
  FOR INSERT WITH CHECK (true);

-- Only admins can SELECT logs
CREATE POLICY "Admins can view logs" ON public.calculation_logs
  FOR SELECT USING (public.is_admin(auth.uid()));

-- Only admins can delete logs
CREATE POLICY "Admins can delete logs" ON public.calculation_logs
  FOR DELETE USING (public.is_admin(auth.uid()));

-- Visit logs table
CREATE TABLE public.visit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  module TEXT NOT NULL DEFAULT 'cementing',
  ip_address TEXT,
  user_agent TEXT,
  page_url TEXT
);
ALTER TABLE public.visit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert visits" ON public.visit_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view visits" ON public.visit_logs
  FOR SELECT USING (public.is_admin(auth.uid()));
