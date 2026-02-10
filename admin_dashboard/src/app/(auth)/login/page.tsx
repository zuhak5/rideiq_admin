'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setServerError(error.message);
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="max-w-md w-full rounded-xl border bg-white p-6">
        <h1 className="text-xl font-semibold">Admin Login</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Sign in with your Supabase account. Access is restricted to admin users.
        </p>

        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700">Email</label>
            <input
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              {...form.register('email')}
            />
            {form.formState.errors.email ? (
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              {...form.register('password')}
            />
            {form.formState.errors.password ? (
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p>
            ) : null}
          </div>

          {serverError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {serverError}
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 text-white py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs text-neutral-500">
          Tip: Ensure your account is present in <code>admin_users</code> or has <code>profiles.is_admin=true</code>.
        </p>
      </div>
    </main>
  );
}
