import { hasAdminAccess } from '@/lib/auth/access';

describe('hasAdminAccess', () => {
  it('returns true when the rpc confirms admin access', async () => {
    const supabase = {
      rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    };

    await expect(hasAdminAccess(supabase)).resolves.toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('is_admin');
  });

  it('throws when the rpc check fails', async () => {
    const supabase = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'permission lookup failed' },
      }),
    };

    await expect(hasAdminAccess(supabase)).rejects.toThrow(
      'Failed to check admin privileges: permission lookup failed',
    );
  });
});
