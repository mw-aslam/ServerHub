import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/Dashboard';
import { hasSession } from '@/lib/auth';
import { appVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (!(await hasSession())) redirect('/login');
  return <Dashboard version={appVersion()} />;
}
