import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const sessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid session payload' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession(parsed.data);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true });
}
