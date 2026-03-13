import { errorJson } from "../_shared/json.ts";
import { withRequestContext } from "../_shared/requestContext.ts";

export async function handleAuthPhoneStatus(req: Request): Promise<Response> {
  return await withRequestContext("auth-phone-status", req, async () => {
    if (req.method !== "POST") {
      return errorJson("Method not allowed", 405, "METHOD_NOT_ALLOWED");
    }

    return errorJson(
      "This auth entrypoint has been disabled. Upgrade the app to continue.",
      410,
      "LEGACY_FLOW_DISABLED",
    );
  });
}

if (import.meta.main) {
  Deno.serve(handleAuthPhoneStatus);
}
