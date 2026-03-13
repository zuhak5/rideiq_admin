import { errorJson } from "../_shared/json.ts";

export function handleSmsProviderProbe(_req: Request): Response {
  return errorJson(
    "SMS provider probing is disabled in this deployment.",
    410,
    "SMS_PROVIDER_PROBE_DISABLED",
  );
}

if (import.meta.main) {
  Deno.serve(handleSmsProviderProbe);
}
