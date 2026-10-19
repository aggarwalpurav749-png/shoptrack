import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Field, Icon, TextInput, useToast } from './ui.jsx';

export default function ChangePasswordForm({ onDone }) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { changePassword } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.current) errs.current = t('Enter your current password');
    if (form.next.length < 8) errs.next = t('At least 8 characters');
    else if (!/[A-Za-z]/.test(form.next) || !/\d/.test(form.next)) errs.next = t('Use letters and numbers');
    if (form.confirm !== form.next) errs.confirm = t('Passwords do not match');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      await changePassword(form.current, form.next);
      toast.success(t('Password changed'));
      setForm({ current: '', next: '', confirm: '' });
      if (onDone) onDone();
      else navigate('/', { replace: true });
    } catch (err) {
      setErrors({ current: err.fields && err.fields.currentPassword, next: err.fields && err.fields.newPassword });
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t('Current password')} error={errors.current}>
        <TextInput type={type} autoComplete="current-password" value={form.current} onChange={set('current')} error={errors.current} />
      </Field>
      <Field label={t('New password')} error={errors.next} hint={t('At least 8 characters, with letters and numbers')}>
        <TextInput type={type} autoComplete="new-password" value={form.next} onChange={set('next')} error={errors.next} />
      </Field>
      <Field label={t('Confirm new password')} error={errors.confirm}>
        <TextInput type={type} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
      </Field>
      <button type="button" onClick={() => setShow((s) => !s)} className="flex items-center gap-2 text-sm font-medium text-slate-600">
        <Icon name={show ? 'eye-off' : 'eye'} className="h-4 w-4" />
        {show ? t('Hide passwords') : t('Show passwords')}
      </button>
      <Button type="submit" loading={busy} className="w-full">
        {t('Change password')}
      </Button>
    </form>
  );
}
