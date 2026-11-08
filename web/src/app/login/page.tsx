import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { hasSession } from '@/lib/auth';
import { appVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Вход — ServerHub' };

export default async function LoginPage() {
  if (await hasSession()) redirect('/');
  return <LoginForm version={appVersion()} />;
}
