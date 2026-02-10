import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createUserClient, requireUser } from "../_shared/supabase.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "86400",
  };
}

serve((req) =>
  withRequestContext('kyc-required-documents', req, async (_ctx) => {

const origin = req.headers.get("origin");
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });

  const anon = createUserClient(req);
  const { user } = await requireUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders(origin), "content-type": "application/json" } });
  }

  const url = new URL(req.url);
  const role = String(url.searchParams.get("role") ?? "driver").toLowerCase(); // UI mostly driver KYC
  if (role !== 'driver' && role !== 'rider') {
    return new Response(JSON.stringify({ error: "invalid_role" }), { status: 400, headers: { ...corsHeaders(origin), "content-type": "application/json" } });
  }
  const country = (url.searchParams.get("country") ?? "IQ").toUpperCase();

  const { data: types, error: typesErr } = await anon
    .from("kyc_document_types")
    .select("id,key,title,description,role_required,is_required,sort_order,allowed_mime,country_code")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (typesErr) {
    return new Response(JSON.stringify({ error: "types_fetch_failed" }), { status: 400, headers: { ...corsHeaders(origin), "content-type": "application/json" } });
  }

  const filtered = (types ?? []).filter((t) => {
    const roleOk = t.role_required === "both" || t.role_required === role;
    const countryOk = !t.country_code || t.country_code === country;
    return roleOk && countryOk;
  });

  // Current submission state (latest)
  const { data: subs } = await anon
    .from("kyc_submissions")
    .select("id,status,submitted_at,reviewed_at,reviewer_note,created_at")
    .eq("profile_id", user.id)
    .eq("role_context", role)
    .order("created_at", { ascending: false })
    .limit(1);

  const submission = subs?.[0] ?? null;

  // Existing documents for that submission (if any)
  let docs: any[] = [];
  if (submission?.id) {
    const { data: d } = await anon
      .from("kyc_documents")
      .select("id,document_type_id,status,rejection_reason,created_at")
      .eq("submission_id", submission.id);
    docs = d ?? [];
  }

  return new Response(
    JSON.stringify({ role, country, submission, required_documents: filtered, documents: docs }),
    { status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" } },
  );
  }),
);
