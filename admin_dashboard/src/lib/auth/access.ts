type RpcCapableClient = {
  rpc: (
    functionName: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function hasAdminAccess(supabase: RpcCapableClient) {
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error) {
    throw new Error(`Failed to check admin privileges: ${error.message}`);
  }
  return Boolean(isAdmin);
}
