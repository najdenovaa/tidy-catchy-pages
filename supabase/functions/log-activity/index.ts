import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Approximate public IP network details; not visitor's address or employer. */
async function resolveNetwork(ip: string): Promise<{location:string|null;metadata:Record<string,unknown>|null}> {
  if (!ip || ip === "unknown" || !/^[a-fA-F0-9:.]+$/.test(ip)) return {location:null,metadata:null};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    let response: Response;
    try { response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {signal:controller.signal}); }
    finally { clearTimeout(timeout); }
    if (!response.ok) return {location:null,metadata:null};
    const d = await response.json();
    if (!d.success) return {location:null,metadata:null};
    const c = d.connection || {};
    const metadata:Record<string,unknown> = {
      country: d.country || null, region: d.region || null, city: d.city || null,
      countryCode: d.country_code || null, continent: d.continent || null,
      postalCode: d.postal || null, timezone: d.timezone?.id || null,
      asn: c.asn || null, isp: c.isp || null, organization: c.org || null,
      networkDomain: c.domain || null, source: "ipwho.is",
      accuracy: "network-estimate-not-street-address",
    };
    return {location:[d.city,d.region,d.country].filter(Boolean).join(", ") || null,metadata};
  } catch {
    return {location:null,metadata:null};
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, module, well_data, calc_params, page_url } = await req.json();

    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const userAgent = req.headers.get("user-agent") || "unknown";
    const { location, metadata } = await resolveNetwork(ip);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (type === "visit") {
      await supabase.from("visit_logs").insert({
        module: module || "cementing",
        ip_address: ip,
        user_agent: userAgent,
        page_url: page_url || null,
        location,
        ip_metadata: metadata,
      });
    } else if (type === "calculation") {
      await supabase.from("calculation_logs").insert({
        module: module || "cementing",
        well_data: well_data || null,
        calc_params: calc_params || null,
        ip_address: ip,
        user_agent: userAgent,
        page_url: page_url || null,
        location,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("log-activity error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
