import { createClient } from "@supabase/supabase-js";

// These two are public/safe to expose in frontend code — the anon key only
// grants what your Supabase Row Level Security policies allow.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Copy .env.example to .env and fill them in."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
