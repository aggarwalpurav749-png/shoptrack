import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import ChangePasswordForm from '../components/ChangePasswordForm.jsx';
import { Button, PageHeader } from '../components/ui.jsx';

export default function Account() {
  const { t, lang, toggle } = useI18n();
  const { user, logout } = useAuth();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={t('Account')} />
      <div className="card mb-4 p-5">
        <p className="text-lg font-bold text-slate-900">{user.name}</p>
        <p className="text-sm text-slate-500">{user.email}</p>
        {user.phone && <p className="text-sm text-slate-500">{user.phone}</p>}
        <p className="mt-2 inline-block rounded-full bg-brand-50 px-3 py-0.5 text-xs font-semibold text-brand-800">{user.role === 'ADMIN' ? t('Owner') : t('Agent')}</p>
        {user.role === 'AGENT' && user.workStart && user.workEnd && (
          <p className="mt-3 text-sm text-slate-600">
            {t('Working hours')}: {user.workStart} – {user.workEnd}
          </p>
        )}
      </div>

      <div className="card mb-4 flex items-center justify-between gap-3 p-5">
        <div>
          <p className="font-semibold text-slate-900">{t('Language')}</p>
          <p className="text-sm text-slate-500">{lang === 'en' ? 'English' : 'हिंदी'}</p>
        </div>
        <Button variant="secondary" onClick={toggle}>
          {lang === 'en' ? 'हिंदी' : 'English'}
        </Button>
      </div>

      <div className="card mb-4 p-5">
        <h2 className="mb-4 font-semibold text-slate-900">{t('Change password')}</h2>
        <ChangePasswordForm onDone={() => {}} />
      </div>

      <Button variant="danger" icon="logout" onClick={logout} className="w-full">
        {t('Log out')}
      </Button>
    </div>
  );
}
