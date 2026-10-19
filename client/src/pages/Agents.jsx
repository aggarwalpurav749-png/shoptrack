import { useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import useFetch from '../lib/useFetch.js';
import { whatsappLink } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorBox, Field, Icon, Modal, PageHeader, Skeleton, TextInput, useConfirm, useToast } from '../components/ui.jsx';

const EMPTY = { name: '', email: '', phone: '', workStart: '', workEnd: '', password: '' };

function Credentials({ info, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  if (!info) return null;
  const text = `${t('Your ShopTrack login')}\n${t('Email')}: ${info.email}\n${t('Temporary password')}: ${info.password}\n${t('You will be asked to set a new password at first login.')}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('Copied'));
    } catch (e) {
      toast.error(t('Could not copy. Please write it down.'));
    }
  };
  return (
    <Modal open onClose={onClose} title={t('Login details')} size="sm" footer={<Button className="w-full" onClick={onClose}>{t('Done')}</Button>}>
      <p className="mb-3 text-sm text-slate-600">{t('Share this with the agent now. The password is shown only once.')}</p>
      <div className="rounded-xl bg-slate-100 p-4 text-sm">
        <p className="font-semibold text-slate-900">{info.name}</p>
        <p className="mt-2 text-slate-600">{info.email}</p>
        <p className="mt-1 font-mono text-lg font-bold tracking-wider text-slate-900">{info.password}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" icon="copy" onClick={copy}>
          {t('Copy')}
        </Button>
        {info.phone ? (
          <a className="btn btn-secondary" href={whatsappLink(info.phone, text)} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" className="h-4 w-4" /> WhatsApp
          </a>
        ) : (
          <span />
        )}
      </div>
    </Modal>
  );
}

export default function Agents() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch(() => api.get('/agents'), []);
  const [modal, setModal] = useState({ open: false, agent: null });
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState(null);

  const openModal = (agent) => {
    setForm(
      agent
        ? { name: agent.name, email: agent.email, phone: agent.phone || '', workStart: agent.workStart || '', workEnd: agent.workEnd || '', password: '' }
        : EMPTY
    );
    setErrors({});
    setModal({ open: true, agent });
  };
  const close = () => setModal({ open: false, agent: null });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = t('Name is required');
    if (!form.email.trim()) errs.email = t('Email is required');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (modal.agent) {
        const { password, ...rest } = form; // eslint-disable-line no-unused-vars
        await api.put(`/agents/${modal.agent.id}`, { ...rest, isActive: modal.agent.isActive });
        toast.success(t('Saved'));
      } else {
        const r = await api.post('/agents', form);
        setCreds({ name: r.agent.name, email: r.agent.email, phone: r.agent.phone, password: r.tempPassword });
      }
      close();
      reload();
    } catch (err) {
      setErrors(err.fields || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a) {
    const ok = await confirm({
      title: a.isActive ? t('Disable agent?') : t('Enable agent?'),
      message: a.isActive ? `${a.name} ${t('will be logged out and cannot log in until you enable the account again.')}` : `${a.name} ${t('will be able to log in again.')}`,
      confirmText: a.isActive ? t('Disable') : t('Enable'),
      danger: a.isActive,
    });
    if (!ok) return;
    try {
      await api.put(`/agents/${a.id}`, {
        name: a.name,
        email: a.email,
        phone: a.phone || '',
        workStart: a.workStart || '',
        workEnd: a.workEnd || '',
        isActive: !a.isActive,
      });
      toast.success(t('Saved'));
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function resetPassword(a) {
    const ok = await confirm({
      title: t('Reset password?'),
      message: `${a.name} ${t('will get a new temporary password and must change it at next login.')}`,
      confirmText: t('Reset'),
    });
    if (!ok) return;
    try {
      const r = await api.post(`/agents/${a.id}/reset-password`);
      setCreds({ name: a.name, email: a.email, phone: a.phone, password: r.tempPassword });
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const items = data ? data.items : [];
  return (
    <div>
      <PageHeader
        title={t('Agents')}
        subtitle={t('Staff who visit shops and collect orders')}
        actions={
          <Button icon="plus" onClick={() => openModal(null)}>
            {t('Add agent')}
          </Button>
        }
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}
      {data && items.length === 0 && (
        <EmptyState
          icon="truck"
          title={t('No agents yet')}
          text={t('Add your field staff so they can log in on their phones.')}
          action={
            <Button icon="plus" onClick={() => openModal(null)}>
              {t('Add agent')}
            </Button>
          }
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((a) => (
          <div key={a.id} className={`card p-4 ${a.isActive ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{a.name}</p>
                <p className="truncate text-sm text-slate-500">{a.email}</p>
                {a.phone && <p className="text-sm text-slate-500">{a.phone}</p>}
              </div>
              <Badge tone={a.isActive ? 'green' : 'gray'}>{a.isActive ? t('Active') : t('Disabled')}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="brand">
                {a.partyCount} {t('parties')}
              </Badge>
              {a.workStart && a.workEnd && (
                <Badge tone="blue">
                  {a.workStart}–{a.workEnd}
                </Badge>
              )}
              {a.mustChangePassword && <Badge tone="amber">{t('Password not changed yet')}</Badge>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon="edit" onClick={() => openModal(a)}>
                {t('Edit')}
              </Button>
              <Button size="sm" variant="secondary" icon="key" onClick={() => resetPassword(a)}>
                {t('Reset password')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>
                {a.isActive ? t('Disable') : t('Enable')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={modal.open}
        onClose={close}
        title={modal.agent ? t('Edit agent') : t('Add agent')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              {t('Cancel')}
            </Button>
            <Button type="submit" form="agent-form" loading={busy}>
              {t('Save')}
            </Button>
          </div>
        }
      >
        <form id="agent-form" onSubmit={save} className="space-y-3" noValidate>
          <Field label={t('Name')} required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} />
          </Field>
          <Field label="Email" required error={errors.email}>
            <TextInput type="email" autoCapitalize="none" value={form.email} onChange={set('email')} error={errors.email} />
          </Field>
          <Field label={t('Phone')} error={errors.phone}>
            <TextInput type="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} error={errors.phone} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Work starts')} error={errors.workStart}>
              <TextInput type="time" value={form.workStart} onChange={set('workStart')} error={errors.workStart} />
            </Field>
            <Field label={t('Work ends')} error={errors.workEnd}>
              <TextInput type="time" value={form.workEnd} onChange={set('workEnd')} error={errors.workEnd} />
            </Field>
          </div>
          {!modal.agent && (
            <Field label={t('Password (optional)')} error={errors.password} hint={t('Leave empty and we will make a safe temporary password for you.')}>
              <TextInput value={form.password} onChange={set('password')} error={errors.password} autoComplete="off" />
            </Field>
          )}
        </form>
      </Modal>

      <Credentials info={creds} onClose={() => setCreds(null)} />
    </div>
  );
}
