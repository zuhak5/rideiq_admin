import { persistServerSession } from '@/lib/auth/persistSession';

describe('persistServerSession', () => {
  const fetchMock = jest.fn();
  const mockJson = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    mockJson.mockReset();
    global.fetch = fetchMock as typeof fetch;
  });

  it('posts access and refresh tokens to the session bridge', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: mockJson,
    });

    await persistServerSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
  });

  it('surfaces bridge errors from the response body', async () => {
    mockJson.mockResolvedValue({ ok: false, error: 'Invalid session payload' });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: mockJson,
    });

    await expect(
      persistServerSession({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    ).rejects.toThrow('Invalid session payload');
  });
});
