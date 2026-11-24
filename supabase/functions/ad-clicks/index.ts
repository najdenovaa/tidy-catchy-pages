const siteOrigins = new Set(["https://deallsoft.ru", "https://www.deallsoft.ru"]);
const analyticsUrl = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const targets = new Set(["iceberg", "sts", "pdf_editor", "ios_app", "android_app"]);
const analyticsKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function isAdmin(authorization: string): Promise<boolean> {
  const headers = { apikey: publicKey, Authorization: authorization };
  const userResponse = await fetch(`${analyticsUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return false;
  const { id } = await userResponse.json();
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return false;

  const response = await fetch(`${analyticsUrl}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ _user_id: id }),
  });
  return response.ok && (await response.json()) === true;
}

function analytics(path: string, data: object) {
  return fetch(`${analyticsUrl}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: analyticsKey,
      Authorization: `Bearer ${analyticsKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (!origin || !siteOrigins.has(origin)) return new Response(null, { status: 403 });

  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  try {
    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!targets.has(body?.target)) {
        return new Response(null, { status: 400, headers });
      }
      const ip = request.headers.get("cf-connecting-ip");
      const response = await analytics("site_clicks", { target: body.target, ip_address: ip });
      return new Response(null, { status: response.ok ? 204 : 502, headers });
    }

    if (request.method === "GET") {
      const authorization = request.headers.get("Authorization");
      if (!authorization?.startsWith("Bearer ") || !(await isAdmin(authorization))) {
        return new Response(null, { status: 403, headers });
      }
      const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
      if (!Number.isSafeInteger(page) || page < 0 || page > 42_949_671) {
        return new Response(null, { status: 400, headers });
      }
      const response = await analytics("rpc/site_click_report", { p_offset: page * 50 });
      if (!response.ok) return new Response(null, { status: 502, headers });
      return Response.json(await response.json(), { headers });
    }

    return new Response(null, { status: 405, headers });
  } catch {
    return new Response(null, { status: 502, headers });
  }
});
