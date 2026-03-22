export type MapsConfigDenialCode = "missing_origin" | "origin_not_allowed";

function isDartUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /^Dart\//i.test(userAgent.trim());
}

function isMobileClientPlatform(clientPlatform: string | null): boolean {
  if (!clientPlatform) return false;
  return clientPlatform.trim().toLowerCase() === "mobile";
}

function isLocalhostOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function isAllowedMapsConfigOrigin(
  origin: string | null,
  allowedOrigins: string[],
): boolean {
  if (!origin) return false;
  if (!allowedOrigins.length) return true;
  return allowedOrigins.includes(origin);
}

export function isNativeMapsConfigRequest(params: {
  origin: string | null;
  userAgent: string | null;
  clientPlatform: string | null;
}): boolean {
  if (isMobileClientPlatform(params.clientPlatform)) {
    return true;
  }

  if (!isDartUserAgent(params.userAgent)) {
    return false;
  }

  // Older Flutter mobile builds can arrive without an Origin header or with a
  // synthetic localhost Origin from the native HTTP stack.
  return !params.origin || isLocalhostOrigin(params.origin);
}

export function getMapsConfigRequestDenialCode(params: {
  origin: string | null;
  allowedOrigins: string[];
  userAgent: string | null;
  clientPlatform: string | null;
}): MapsConfigDenialCode | null {
  if (isNativeMapsConfigRequest(params)) {
    return null;
  }

  if (!params.origin) {
    return "missing_origin";
  }

  return isAllowedMapsConfigOrigin(params.origin, params.allowedOrigins)
    ? null
    : "origin_not_allowed";
}

export function canServeMapsConfigRequest(params: {
  origin: string | null;
  allowedOrigins: string[];
  userAgent: string | null;
  clientPlatform: string | null;
}): boolean {
  return getMapsConfigRequestDenialCode(params) === null;
}
