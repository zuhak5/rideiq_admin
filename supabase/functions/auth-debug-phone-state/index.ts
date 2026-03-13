import { errorJson } from "../_shared/json.ts";

export function handleAuthDebugPhoneState(_req: Request): Response {
  return errorJson(
    "This debug auth endpoint is disabled in this deployment.",
    410,
    "AUTH_DEBUG_DISABLED",
  );
}

if (import.meta.main) {
  Deno.serve(handleAuthDebugPhoneState);
}
