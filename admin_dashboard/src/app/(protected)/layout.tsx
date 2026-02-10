import { Sidebar } from '@/components/shell/Sidebar';
import { TopNav } from '@/components/shell/TopNav';
import { getAdminContext } from '@/lib/auth/guards';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();

  return (
    <div className="min-h-screen bg-neutral-50 flex">
      <Sidebar permissions={ctx.permissions} />
      <div className="flex-1 flex flex-col">
        <TopNav email={ctx.user.email ?? null} roles={ctx.roles} permissions={ctx.permissions} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
