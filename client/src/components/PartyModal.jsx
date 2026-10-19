import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { money, phoneLink, whatsappLink } from '../lib/format.js';
import { Button, Field, Icon, Modal, Select, TextInput, useConfirm, useToast } from './ui.jsx';

const EMPTY = {
  name: '',
  ownerName: '',
  phone: '',
  email: '',
  address: '',
  area: '',
  creditLimit: '',
  openingBalance: '',
  assignedAgentId: '',
};

const fromParty = (p) =>
  p
    ? {
        name: p.name || '',
        ownerName: p.ownerName || '',
        phone: p.phone || '',
        email: p.email || '',
        address: p.address || '',
        area: p.area || '',
        creditLimit: p.creditLimit ? String(p.creditLimit) : '',
        openingBalance: p.openingBalance ? String(p.openingBalance) : '',
        assignedAgentId: p.assignedAgentId ? String(p.assignedAgentId) : '',
      }
    : EMPTY;

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

export default function PartyModal({ open, party, isAdmin, areas, agents, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(fromParty(party));
      setErrors({});
    }
  }, [open, party]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: t('Party name is required') });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      if (party) await api.put(`/parties/${party.id}`, form);
      else await api.post('/parties', form);
      toast.success(t('Saved'));
      onSaved();
    } catch (err) {
      setErrors(err.fields || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t('Delete party?'),
      message: `${party.name} ${t('will be removed from your list. Old records stay safe.')}`,
      confirmText: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del(`/parties/${party.id}`);
      toast.success(t('Party deleted'));
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ─── agent (read only) ───
  if (!isAdmin) {
    return (
      <Modal open={open} onClose={onClose} title={party ? party.name : ''}>
        {party && (
          <>
            <dl>
              <Row label={t('Owner')}>{party.ownerName}</Row>
              <Row label={t('Phone')}>{party.phone}</Row>
              <Row label={t('Address')}>{party.address}</Row>
              <Row label={t('Area')}>{party.area}</Row>
              <Row label={t('Credit limit')}>{money(party.creditLimit)}</Row>
              <Row label={t('Outstanding')}>{money(party.currentBalance)}</Row>
            </dl>
            {party.phone && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <a href={phoneLink(party.phone)} className="btn btn-primary">
                  <Icon name="phone" className="h-4 w-4" /> {t('Call')}
                </a>
                <a href={whatsappLink(party.phone)} target="_blank" rel="noreferrer" className="btn btn-secondary">
                  <Icon name="whatsapp" className="h-4 w-4" /> WhatsApp
                </a>
              </div>
            )}
          </>
        )}
      </Modal>
    );
  }

  // ─── owner (edit) ───
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={party ? t('Edit party') : t('Add party')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {party ? (
            <Button variant="ghost" className="text-red-600" icon="trash" onClick={remove} disabled={busy}>
              {t('Delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" form="party-form" loading={busy}>
              {t('Save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="party-form" onSubmit={save} className="space-y-3" noValidate>
        <Field label={t('Party / shop name')} required error={errors.name}>
          <TextInput value={form.name} onChange={set('name')} error={errors.name} autoFocus={!party} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Owner name')} error={errors.ownerName}>
            <TextInput value={form.ownerName} onChange={set('ownerName')} error={errors.ownerName} />
          </Field>
          <Field label={t('Phone')} error={errors.phone}>
            <TextInput type="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="10 digit" />
          </Field>
        </div>
        <Field label="Email" error={errors.email}>
          <TextInput type="email" value={form.email} onChange={set('email')} error={errors.email} />
        </Field>
        <Field label={t('Address')} error={errors.address}>
          <TextInput value={form.address} onChange={set('address')} error={errors.address} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Area')} error={errors.area}>
            <TextInput list="party-areas" value={form.area} onChange={set('area')} error={errors.area} />
            <datalist id="party-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Credit limit')} error={errors.creditLimit}>
            <TextInput type="number" inputMode="decimal" min="0" value={form.creditLimit} onChange={set('creditLimit')} error={errors.creditLimit} placeholder="0" />
          </Field>
          <Field label={t('Opening balance')} error={errors.openingBalance} hint={t('Positive = the party owes you')}>
            <TextInput type="number" inputMode="decimal" value={form.openingBalance} onChange={set('openingBalance')} error={errors.openingBalance} placeholder="0" />
          </Field>
        </div>
        <Field label={t('Assigned agent')} error={errors.assignedAgentId}>
          <Select value={form.assignedAgentId} onChange={set('assignedAgentId')}>
            <option value="">{t('— No agent —')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
