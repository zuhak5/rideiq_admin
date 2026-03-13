import { normalizeIraqPhoneE164 } from "./phone.ts";

export function maskPhoneForLogs(
  phone: string | null | undefined,
): string | null {
  if (!phone) {
    return null;
  }

  try {
    const normalized = normalizeIraqPhoneE164(phone);
    const digits = normalized.replace(/\D/g, "");
    const visiblePrefix = digits.slice(0, 4);
    const visibleSuffix = digits.slice(-2);
    const hiddenLength = Math.max(
      0,
      digits.length - visiblePrefix.length - visibleSuffix.length,
    );
    return `+${visiblePrefix}${"*".repeat(hiddenLength)}${visibleSuffix}`;
  } catch {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length <= 2) {
      return "***";
    }
    return `***${digits.slice(-2)}`;
  }
}
