export function isAllowedMapsUsageOrigin(
  origin: string | null,
  allowedOrigins: string[],
): boolean {
  if (!allowedOrigins.length) return true;
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function isTelemetryOriginSatisfied(params: {
  requestOrigin: string | null;
  tokenOrigin: string | null;
  hasAuthenticatedUser: boolean;
}): boolean {
  if (params.hasAuthenticatedUser) return true;
  if (!params.tokenOrigin) return true;
  return params.requestOrigin === params.tokenOrigin;
}
