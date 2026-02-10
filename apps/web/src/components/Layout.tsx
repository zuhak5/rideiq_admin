import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import NotificationsButton from './NotificationsButton';
import RoleSwitcher from './RoleSwitcher';
import VoiceCallListener from './VoiceCallListener';
import { debounce } from '../lib/debounce';
import i18n, { applyDocumentLocale, LOCALE_STORAGE_KEY, normalizeLanguage, type SupportedLanguage } from '../i18n';
import CopilotWidget from './CopilotWidget';

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { t } = useTranslation();
  const [lang, setLang] = React.useState<SupportedLanguage>(normalizeLanguage(i18n.language));
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [uid, setUid] = React.useState<string | null>(null);
  const [unread, setUnread] = React.useState(0);

  const setLanguage = React.useCallback(
    async (next: SupportedLanguage) => {
      setLang(next);
      i18n.changeLanguage(next);
      applyDocumentLocale(next);
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      if (uid) {
        await supabase.from('profiles').update({ locale: next }).eq('id', uid);
      }
    },
    [uid],
  );

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const id = sess.session?.user.id ?? null;
      if (!id) return;
      setUid(id);
      const { data, error } = await supabase.from('profiles').select('locale').eq('id', id).maybeSingle();
      const { data: adminFlag, error: adminErr } = await supabase.rpc('is_admin');
      if (!alive) return;
      if (error) {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(!adminErr && !!(Array.isArray(adminFlag) ? adminFlag[0] : adminFlag));

      const profileLocale = normalizeLanguage(data?.locale ?? null);
      setLanguage(profileLocale);
    })();
    return () => {
      alive = false;
    };
  }, [setLanguage]);

  React.useEffect(() => {
    if (!uid) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const fetchUnread = async () => {
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .is('read_at', null);
      if (!cancelled && !error) setUnread(count ?? 0);
    };

    const fetchUnreadDebounced = debounce(() => {
      void fetchUnread();
    }, 300);

    void fetchUnread();

    channel = supabase
      .channel(`header-notifications:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${uid}` }, () => {
        fetchUnreadDebounced();
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [uid]);

  return (
    <div className="min-h-screen">
      <VoiceCallListener uid={uid} />
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-black text-white flex items-center justify-center font-semibold">R</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{t('app.name')}</div>
              <div className="text-xs text-gray-500">Wallet + payouts (QiCard / AsiaPay / ZainCash)</div>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <Tab to="/home" active={loc.pathname.startsWith('/home')}>{t('nav.home')}</Tab>
            <Tab to="/rider" active={loc.pathname.startsWith('/rider')}>{t('nav.rider')}</Tab>
            <Tab to="/scheduled" active={loc.pathname.startsWith('/scheduled')}>{t('nav.scheduled')}</Tab>
            <Tab to="/businesses" active={loc.pathname.startsWith('/business') || loc.pathname.startsWith('/businesses')}>{t('nav.businesses')}</Tab>
            <Tab to="/orders" active={loc.pathname.startsWith('/orders') || loc.pathname.startsWith('/checkout')}>{t('nav.orders')}</Tab>
            <Tab to="/interests" active={loc.pathname.startsWith('/interests')}>{t('nav.interests')}</Tab>
            <Tab to="/chats" active={loc.pathname.startsWith('/chats')}>{t('nav.chats')}</Tab>
            <Tab to="/driver" active={loc.pathname.startsWith('/driver')}>{t('nav.driver')}</Tab>
            <Tab to="/merchant" active={loc.pathname.startsWith('/merchant') || loc.pathname.startsWith('/merchant-chat')}>{t('nav.merchant')}</Tab>
            <Tab to="/wallet" active={loc.pathname.startsWith('/wallet')}>{t('nav.wallet')}</Tab>
            <Tab to="/history" active={loc.pathname.startsWith('/history')}>{t('nav.history')}</Tab>
            {uid ? <RoleSwitcher /> : null}
            {uid ? <NotificationsButton count={unread} to="/wallet?tab=notifications" /> : null}
            {isAdmin ? (
              <Tab to="/admin/payments" active={loc.pathname.startsWith('/admin')}>{t('nav.admin')}</Tab>
            ) : null}

            <label className="hidden md:flex items-center gap-2 text-xs text-gray-600">
              <span>{t('language.label')}</span>
              <select
                className="rounded-md border px-2 py-1 text-sm"
                value={lang}
                onChange={(e) => void setLanguage(e.target.value as SupportedLanguage)}
              >
                <option value="en">{t('language.english')}</option>
                <option value="ar">{t('language.arabic')}</option>
              </select>
            </label>
            <button
              className="btn"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      <CopilotWidget />
    </div>
  );
}

function Tab({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={
        active
          ? 'btn btn-primary'
          : 'btn'
      }
    >
      {children}
    </Link>
  );
}
