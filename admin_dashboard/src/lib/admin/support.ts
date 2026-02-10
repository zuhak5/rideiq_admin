import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type SupportTicketRow = {
  id: string;
  category_code: string | null;
  category_title: string | null;
  subject: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high';
  ride_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_phone: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
  messages_count: number;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  message: string;
  attachments: any[];
  created_at: string;
};

export type SupportInternalNote = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  note: string;
  created_at: string;
};

export type SupportTicket = {
  id: string;
  category_code: string;
  subject: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high';
  ride_id: string | null;
  created_by: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportSectionRow = {
  id: string;
  key: string;
  title: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SupportArticleRow = {
  id: string;
  section_id: string | null;
  section_title: string | null;
  slug: string;
  title: string;
  summary: string | null;
  tags: string[];
  enabled: boolean;
  updated_at: string;
};

export type SupportArticle = {
  id: string;
  section_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export async function listSupportTickets(
  supabase: SupabaseClient,
  args: {
    q?: string;
    status?: string | null;
    priority?: string | null;
    assigned_to?: string | null;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ tickets: SupportTicketRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    tickets: SupportTicketRow[];
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-support-tickets-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? null,
      priority: args.priority ?? null,
      assigned_to: args.assigned_to ?? null,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    },
  });
  return { tickets: data.tickets ?? [], page: data.page };
}

export async function getSupportTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{
  ticket: SupportTicket;
  category: { code: string; title: string } | null;
  creator: { id: string; display_name: string | null; phone: string | null } | null;
  assignee: { id: string; display_name: string | null; phone: string | null } | null;
  messages: SupportMessage[];
  internal_notes: SupportInternalNote[];
}> {
  noStore();
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-ticket-get',
    method: 'GET',
    query: { ticket_id: ticketId },
  });
  return {
    ticket: data.ticket,
    category: data.category ?? null,
    creator: data.creator ?? null,
    assignee: data.assignee ?? null,
    messages: data.messages ?? [],
    internal_notes: data.internal_notes ?? [],
  };
}

export async function assignSupportTicket(
  supabase: SupabaseClient,
  body: { ticket_id: string; assigned_to?: string | null; note?: string | null },
): Promise<{ ticket: SupportTicket }> {
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-ticket-assign',
    method: 'POST',
    body,
  });
  return { ticket: data.ticket };
}

export async function setSupportTicketStatus(
  supabase: SupabaseClient,
  body: { ticket_id: string; status: 'open' | 'pending' | 'resolved' | 'closed'; note?: string | null },
): Promise<{ ticket: SupportTicket }> {
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-ticket-set-status',
    method: 'POST',
    body,
  });
  return { ticket: data.ticket };
}

export async function replyToSupportTicket(
  supabase: SupabaseClient,
  body: { ticket_id: string; message: string; attachments?: any[] },
): Promise<{ message: SupportMessage }> {
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-ticket-reply',
    method: 'POST',
    body,
  });
  return { message: data.message };
}

export async function addSupportInternalNote(
  supabase: SupabaseClient,
  body: { ticket_id: string; note: string },
): Promise<{ note: SupportInternalNote }> {
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-ticket-add-note',
    method: 'POST',
    body,
  });
  return { note: data.note };
}

export async function listSupportSections(
  supabase: SupabaseClient,
): Promise<{ sections: SupportSectionRow[] }> {
  noStore();
  const data = await invokeEdgeFunction<{ ok: boolean; sections: SupportSectionRow[] }>(supabase, 'admin-api', {
    path: 'admin-support-sections-list',
    method: 'GET',
  });
  return { sections: data.sections ?? [] };
}

export async function upsertSupportSection(
  supabase: SupabaseClient,
  body: { id?: string | null; key: string; title: string; sort_order?: number; enabled?: boolean },
): Promise<{ section: SupportSectionRow }> {
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-section-upsert',
    method: 'POST',
    body,
  });
  return { section: data.section };
}

export async function listSupportArticles(
  supabase: SupabaseClient,
  args: {
    q?: string;
    section_id?: string | null;
    enabled?: boolean | null;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ articles: SupportArticleRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-articles-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      section_id: args.section_id ?? null,
      enabled: args.enabled ?? null,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    },
  });
  return { articles: data.articles ?? [], page: data.page };
}

export async function getSupportArticle(
  supabase: SupabaseClient,
  id: string,
): Promise<{ article: SupportArticle }> {
  noStore();
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-article-get',
    method: 'GET',
    query: { id },
  });
  return { article: data.article };
}

export async function upsertSupportArticle(
  supabase: SupabaseClient,
  body: {
    id?: string | null;
    section_id?: string | null;
    slug: string;
    title: string;
    summary?: string | null;
    body_md?: string;
    tags?: string[];
    enabled?: boolean;
  },
): Promise<{ article: SupportArticle }> {
  const data = await invokeEdgeFunction<any>(supabase, 'admin-api', {
    path: 'admin-support-article-upsert',
    method: 'POST',
    body,
  });
  return { article: data.article };
}
