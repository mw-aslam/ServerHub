import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/Dashboard';
import { hasSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (!(await hasSession())) redirect('/login');
  return <Dashboard />;
}
