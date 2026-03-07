type SessionTokens = {
  access_token: string;
  refresh_token: string;
};

function messageFromBridgeError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) {
      return error;
    }
  }
  return `Failed to persist server session (${status})`;
}

export async function persistServerSession(session: SessionTokens): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  });

  if (response.ok) {
    return;
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore invalid JSON and fall back to the status message.
  }

  throw new Error(messageFromBridgeError(payload, response.status));
}
