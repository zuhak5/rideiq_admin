import React from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { normalizeIraqPhoneE164, PhoneNormalizationError } from '../lib/phone';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<Session | null>(null);

  const [error, setError] = React.useState<string | null>(null);

  // Email/password mode
  const [mode, setMode] = React.useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  // Phone OTP mode
  const [authMethod, setAuthMethod] = React.useState<'email' | 'phone'>('email');
  const [phone, setPhone] = React.useState('');
  const [phoneE164, setPhoneE164] = React.useState<string | null>(null);
  const [otp, setOtp] = React.useState('');
  const [phoneStage, setPhoneStage] = React.useState<'enter_phone' | 'enter_code'>('enter_phone');
  const [phoneBusy, setPhoneBusy] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="card w-full max-w-md p-6">
          <div className="text-lg font-semibold">Supabase not configured</div>
          <div className="text-sm text-gray-600 mt-2">
            This build is missing <span className="font-mono">VITE_SUPABASE_URL</span> or{' '}
            <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> (or alias{' '}
            <span className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</span>).
          </div>
          <div className="text-xs text-gray-500 mt-3 space-y-1">
            <div>• Local dev: create <span className="font-mono">apps/web/.env</span> with those variables.</div>
            <div>• GitHub Pages: set repository secrets used by the workflow (same variable names).</div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="card w-full max-w-md p-6">
          <div className="text-lg font-semibold">Welcome</div>
          <div className="text-sm text-gray-500 mt-1">Sign in to test the rider/driver flows.</div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className={authMethod === 'email' ? 'btn btn-primary flex-1' : 'btn flex-1'}
              onClick={() => {
                setError(null);
                setAuthMethod('email');
              }}
            >
              Email
            </button>
            <button
              type="button"
              className={authMethod === 'phone' ? 'btn btn-primary flex-1' : 'btn flex-1'}
              onClick={() => {
                setError(null);
                setAuthMethod('phone');
              }}
            >
              Phone OTP (Iraq)
            </button>
          </div>

          {authMethod === 'email' ? (
            <form
              className="mt-6 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);

                // IMPORTANT: Don't detach auth methods (they rely on `this`).
                // Calling them as standalone functions breaks the internal context and can crash.
                const res =
                  mode === 'signIn'
                    ? await supabase.auth.signInWithPassword({ email, password })
                    : await supabase.auth.signUp({ email, password });

                if (res.error) setError(res.error.message);
              }}
            >
              <div>
                <div className="label">Email</div>
                <input
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <div className="label">Password</div>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  required
                />
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <button className="btn btn-primary w-full" type="submit">
                {mode === 'signIn' ? 'Sign in' : 'Create account'}
              </button>

              <button
                className="btn w-full"
                type="button"
                onClick={() => setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'))}
              >
                {mode === 'signIn' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
              </button>

              <div className="text-xs text-gray-500">
                Production: prefer phone OTP + driver onboarding.
              </div>
            </form>
          ) : (
            <form
              className="mt-6 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                setPhoneBusy(true);
                try {
                  if (phoneStage === 'enter_phone') {
                    const normalized = normalizeIraqPhoneE164(phone);
                    setPhoneE164(normalized);

                    const res = await supabase.auth.signInWithOtp({
                      phone: normalized,
                      options: { shouldCreateUser: true },
                    });

                    if (res.error) throw res.error;
                    setPhoneStage('enter_code');
                  } else {
                    if (!phoneE164) throw new Error('Missing phone. Go back and enter your phone again.');
                    const token = otp.trim();
                    if (!/^[0-9]{4,8}$/.test(token)) throw new Error('Enter the numeric OTP code.');

                    const res = await supabase.auth.verifyOtp({
                      phone: phoneE164,
                      token,
                      type: 'sms',
                    });

                    if (res.error) throw res.error;
                    // Session updates through onAuthStateChange.
                  }
                } catch (err) {
                  const msg =
                    err instanceof PhoneNormalizationError
                      ? err.message
                      : err instanceof Error
                        ? err.message
                        : String(err);
                  setError(msg);
                } finally {
                  setPhoneBusy(false);
                }
              }}
            >
              <div>
                <div className="label">Iraqi mobile number</div>
                <input
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XXXXXXXXX or +9647XXXXXXXXX"
                  autoComplete="tel"
                  disabled={phoneStage === 'enter_code'}
                  required
                />
                <div className="text-xs text-gray-500 mt-1">Only Iraqi mobile numbers are allowed (9647…)</div>
              </div>

              {phoneStage === 'enter_code' && (
                <div>
                  <div className="label">OTP code</div>
                  <input
                    className="input"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </div>
              )}

              {error && <div className="text-sm text-red-600">{error}</div>}

              <button className="btn btn-primary w-full" type="submit" disabled={phoneBusy}>
                {phoneStage === 'enter_phone' ? 'Send code' : 'Verify code'}
              </button>

              {phoneStage === 'enter_code' ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="btn w-full"
                    type="button"
                    disabled={phoneBusy}
                    onClick={() => {
                      setError(null);
                      setOtp('');
                      setPhoneStage('enter_phone');
                    }}
                  >
                    Change phone
                  </button>
                  <button
                    className="btn w-full"
                    type="button"
                    disabled={phoneBusy}
                    onClick={async () => {
                      setError(null);
                      setPhoneBusy(true);
                      try {
                        const normalized = normalizeIraqPhoneE164(phone);
                        setPhoneE164(normalized);
                        const res = await supabase.auth.signInWithOtp({
                          phone: normalized,
                          options: { shouldCreateUser: true },
                        });
                        if (res.error) throw res.error;
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setError(msg);
                      } finally {
                        setPhoneBusy(false);
                      }
                    }}
                  >
                    Resend
                  </button>
                </div>
              ) : (
                <div className="text-xs text-gray-500">
                  This uses Supabase Phone Login. SMS delivery is handled via the <span className="font-mono">Send SMS Hook</span> edge function.
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
