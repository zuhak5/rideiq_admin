export function isAllowedMapsConfigOrigin(
  origin: string | null,
  allowedOrigins: string[],
): boolean {
  if (!allowedOrigins.length) return true;
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function canServeMapsConfigRequest(params: {
  origin: string | null;
  allowedOrigins: string[];
  hasAuthenticatedUser: boolean;
}): boolean {
  return (
    isAllowedMapsConfigOrigin(params.origin, params.allowedOrigins) ||
    params.hasAuthenticatedUser
  );
}
