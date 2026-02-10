import { supabase } from './supabaseClient';
import type { Database } from './database.types';

export type MerchantStatus = Database['public']['Enums']['merchant_status'];

export type Merchant = {
  id: string;
  owner_profile_id: string;
  business_name: string;
  business_type: string;
  status: MerchantStatus;
  contact_phone: string | null;
  address_text: string | null;
};

export type MerchantProduct = {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_iqd: number;
  compare_at_price_iqd: number | null;
  is_active: boolean;
  is_featured: boolean;
  stock_qty: number | null;
  images: any[];
};


export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'featured';

export type MerchantPromotion = {
  id: string;
  merchant_id: string;
  product_id: string | null;
  category: string | null;
  discount_type: Database['public']['Enums']['merchant_promotion_discount_type'];
  value: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type ChatMessageCursor = { created_at: string; id: string };
export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error('Not authenticated');
  return data.user.id;
}

export async function listApprovedMerchants() {
  const { data, error } = await supabase
    .from('merchants')
    .select('id,business_name,business_type,status')
    .eq('status', 'approved')
    .order('business_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Pick<Merchant, 'id' | 'business_name' | 'business_type' | 'status'>[];
}

export async function getMerchant(merchantId: string) {
  const { data, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('id', merchantId)
    .maybeSingle();
  if (error) throw error;
  return data as Merchant | null;
}

export async function getMyMerchant() {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('owner_profile_id', uid)
    .maybeSingle();
  if (error) throw error;
  return data as Merchant | null;
}

export async function createMyMerchant(input: { business_name: string; business_type: string; contact_phone?: string; address_text?: string }) {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase
    .from('merchants')
    .insert({
      owner_profile_id: uid,
      business_name: input.business_name,
      business_type: input.business_type,
      contact_phone: input.contact_phone ?? null,
      address_text: input.address_text ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Merchant;
}

export async function listMerchantProducts(merchantId: string, includeInactive = false) {
  let q = supabase.from('merchant_products').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false });
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MerchantProduct[];
}


export async function listMerchantProductCategories(merchantId: string, includeInactive = false): Promise<string[]> {
  let q = supabase.from('merchant_products').select('category').eq('merchant_id', merchantId).not('category', 'is', null).order('category', { ascending: true });
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const c = (row?.category ?? '').toString().trim();
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export async function getMerchantProductsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('merchant_products').select('*').in('id', ids);
  if (error) throw error;
  return (data ?? []) as MerchantProduct[];
}

export async function createMerchantProduct(input: Omit<MerchantProduct, 'id'>) {
  const { data, error } = await supabase.from('merchant_products').insert(input).select('*').single();
  if (error) throw error;
  return data as MerchantProduct;
}

export async function updateMerchantProduct(productId: string, patch: Partial<MerchantProduct>) {
  const { data, error } = await supabase.from('merchant_products').update(patch).eq('id', productId).select('*').single();
  if (error) throw error;
  return data as MerchantProduct;
}

export async function deleteMerchantProduct(productId: string) {
  const { error } = await supabase.from('merchant_products').delete().eq('id', productId);
  if (error) throw error;
}

export async function merchantChatGetOrCreateThread(merchantId: string) {
  const { data, error } = await supabase.rpc('merchant_chat_get_or_create_thread', { p_merchant_id: merchantId });
  if (error) throw error;
  return data as string;
}

export async function listMyCustomerThreads() {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase
    .from('merchant_chat_threads')
    .select('id,merchant_id,customer_id,last_message_at,customer_last_read_at,merchant_last_read_at,updated_at,created_at')
    .eq('customer_id', uid)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function listMerchantThreadsForOwner(merchantId: string) {
  const { data, error } = await supabase
    .from('merchant_chat_threads')
    .select('id,merchant_id,customer_id,last_message_at,customer_last_read_at,merchant_last_read_at,updated_at,created_at')
    .eq('merchant_id', merchantId)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function listChatMessagesKeyset(
  threadId: string,
  cursor: ChatMessageCursor | null = null,
  limit = 50,
): Promise<{ rows: any[]; nextCursor: ChatMessageCursor | null }> {
  const { data, error } = await supabase.rpc('merchant_chat_list_messages', {
    p_thread_id: threadId,
    p_before_created_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const nextCursor = rows.length === limit ? { created_at: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id } : null;
  return { rows, nextCursor };
}

export async function listChatMessages(threadId: string, limit = 100) {
  const { rows } = await listChatMessagesKeyset(threadId, null, limit);
  // RPC returns DESC; keep existing UI expectations (ASC)
  return rows.slice().reverse();
}

export async function merchantChatMarkRead(threadId: string) {
  const { error } = await supabase.rpc('merchant_chat_mark_read', { p_thread_id: threadId });
  if (error) throw error;
}

export async function sendChatMessage(threadId: string, body: string) {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase
    .from('merchant_chat_messages')
    .insert({ thread_id: threadId, sender_id: uid, body, message_type: 'text', attachments: [] })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPublicProfiles(ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('public_profiles').select('id,display_name,rating_avg,rating_count').in('id', ids);
  if (error) throw error;
  return (data ?? []) as any[];
}


export async function listMerchantProductsPaged(
  merchantId: string,
  includeInactive = false,
  page = 0,
  pageSize = 20,
  opts?: { q?: string; category?: string | null; featuredOnly?: boolean; sort?: ProductSort },
) {
  const from = page * pageSize;
  const to = from + pageSize; // inclusive => pageSize + 1 results
  const qText = (opts?.q ?? '').trim();
  const cat = (opts?.category ?? '').trim();
  const featuredOnly = Boolean(opts?.featuredOnly);
  const sort: ProductSort = (opts?.sort ?? 'newest') as ProductSort;

  let q = supabase.from('merchant_products').select('*').eq('merchant_id', merchantId);

  if (!includeInactive) q = q.eq('is_active', true);
  if (featuredOnly) q = q.eq('is_featured', true);
  if (cat) q = q.eq('category', cat);

  if (qText) {
    // PostgREST OR filter is string-based; avoid problematic characters
    const safe = qText.replace(/[(),]/g, ' ').trim().slice(0, 80);
    if (safe) q = q.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  switch (sort) {
    case 'featured':
      q = q.order('is_featured', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false });
      break;
    case 'price_asc':
      q = q.order('price_iqd', { ascending: true }).order('created_at', { ascending: false }).order('id', { ascending: false });
      break;
    case 'price_desc':
      q = q.order('price_iqd', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false });
      break;
    case 'newest':
    default:
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false });
      break;
  }

  q = q.range(from, to);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as MerchantProduct[];
  const hasMore = rows.length > pageSize;
  return { rows: rows.slice(0, pageSize), hasMore };
}

export async function adminSetMerchantStatus(merchantId: string, status: MerchantStatus, note?: string | null) {
  const { data, error } = await supabase.rpc('admin_set_merchant_status', {
    p_merchant_id: merchantId,
    p_status: status,
    p_note: (note ?? '').trim() || null,
  });
  if (error) throw error;
  return data as any;
}


export async function listMerchantPromotions(merchantId: string, includeInactive = false) {
  let q = supabase.from('merchant_promotions').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false });
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MerchantPromotion[];
}

export async function createMerchantPromotion(input: Omit<MerchantPromotion, 'id' | 'created_at'>) {
  const { data, error } = await supabase.from('merchant_promotions').insert(input).select('*').single();
  if (error) throw error;
  return data as MerchantPromotion;
}

export async function updateMerchantPromotion(promoId: string, patch: Partial<MerchantPromotion>) {
  const { data, error } = await supabase.from('merchant_promotions').update(patch).eq('id', promoId).select('*').single();
  if (error) throw error;
  return data as MerchantPromotion;
}

export async function deleteMerchantPromotion(promoId: string) {
  const { error } = await supabase.from('merchant_promotions').delete().eq('id', promoId);
  if (error) throw error;
}

export function isPromotionActive(p: MerchantPromotion, now = new Date()): boolean {
  if (!p.is_active) return false;
  const s = p.starts_at ? new Date(p.starts_at).getTime() : null;
  const e = p.ends_at ? new Date(p.ends_at).getTime() : null;
  const t = now.getTime();
  if (s != null && t < s) return false;
  if (e != null && t > e) return false;
  return true;
}
