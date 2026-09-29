import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { AuthLayout } from '@/features/auth/AuthPages';
import { useSession } from '@/features/auth/session.store';
import { api, errorMessage } from '@/services/api/client';

interface Peek {
  email: string;
  category: string;
  label: string;
  subscribed: boolean;
}

/**
 * Landing page for the unsubscribe link in emails. Works signed out. Loading the page changes
 * nothing (link scanners open URLs); the button does.
 */
export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const signedIn = !!useSession();
  const peek = useQuery({ queryKey: ['unsubscribe', token], queryFn: () => api.get<Peek>('/email/unsubscribe', { token }), retry: false, enabled: !!token });
  const confirm = useMutation({ mutationFn: () => api.raw('POST', `/email/unsubscribe?token=${encodeURIComponent(token)}`) });
  const done = confirm.isSuccess || peek.data?.subscribed === false;

  const manage = signedIn ? (
    <Link to="/settings">Manage all email settings</Link>
  ) : (
    <>
      <Link to="/login">Sign in</Link> to manage all email settings
    </>
  );

  if (!token || peek.isError)
    return (
      <AuthLayout title="Link not valid" subtitle={token ? errorMessage(peek.error) : 'This unsubscribe link is missing its token.'}>
        <p className="muted small">{manage}.</p>
      </AuthLayout>
    );
  if (!peek.data)
    return (
      <AuthLayout title="Unsubscribe" subtitle="Checking your link…">
        <Spinner />
      </AuthLayout>
    );
  if (done)
    return (
      <AuthLayout title="You're unsubscribed" subtitle={`${peek.data.email} won't get “${peek.data.label}” emails any more.`}>
        <p className="unsub-done">
          <CheckCircle2 size={18} /> In-app notifications are unchanged.
        </p>
        <p className="muted small">{manage}.</p>
      </AuthLayout>
    );
  return (
    <AuthLayout title="Unsubscribe?" subtitle={`Stop sending “${peek.data.label}” emails to ${peek.data.email}.`}>
      {confirm.isError && <div className="form-error">{errorMessage(confirm.error)}</div>}
      <button className="btn btn-volt btn-block" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
        {confirm.isPending ? <Spinner /> : 'Unsubscribe'}
      </button>
      <p className="muted small">{manage}.</p>
    </AuthLayout>
  );
}
