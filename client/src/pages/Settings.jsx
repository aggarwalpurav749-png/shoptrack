import { useEffect, useRef, useState } from 'react';
import { api, assetUrl } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { useShop } from '../lib/shop.jsx';
import { compressImage } from '../lib/imageTools.js';
import useFetch from '../lib/useFetch.js';
import { Button, ErrorBox, Field, Icon, PageHeader, Skeleton, TextInput, Textarea, useToast } from '../components/ui.jsx';

const toForm = (s) => ({
  shopName: s.shopName || '',
  phone: s.phone || '',
  email: s.email || '',
  address: s.address || '',
  bankName: s.bankName || '',
  accountNo: s.accountNo || '',
  ifsc: s.ifsc || '',
  upiId: s.upiId || '',
  invoicePrefix: s.invoicePrefix || 'EST',
  defaultGstPercent: String(s.defaultGstPercent ?? 18),
  terms: s.terms || '',
  workStart: s.workStart || '09:00',
  workEnd: s.workEnd || '18:00',
});

function Section({ title, children }) {
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const { setShop } = useShop();
  const logoRef = useRef(null);
  const { data, loading, error, reload } = useFetch(() => api.get('/settings'), []);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);

  useEffect(() => {
    if (data) {
      setForm(toForm(data.settings));
      setLogoUrl(data.settings.logoUrl);
    }
  }, [data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (!form.shopName.trim()) {
      setErrors({ shopName: t('Shop name is required') });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const r = await api.put('/settings', form);
      setShop(r.settings);
      toast.success(t('Settings saved'));
    } catch (err) {
      setErrors(err.fields || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickLogo(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setLogoBusy(true);
    try {
      const small = await compressImage(f, { maxSize: 600, quality: 0.9 });
      const fd = new FormData();
      fd.append('logo', small);
      const r = await api.upload('/settings/logo', fd);
      setLogoUrl(r.settings.logoUrl);
      setShop(r.settings);
      toast.success(t('Logo updated'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      const r = await api.del('/settings/logo');
      setLogoUrl(null);
      setShop(r.settings);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('Settings')} subtitle={t('Shop details used on estimates')} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !form && <Skeleton className="h-96" />}
      {form && (
        <form onSubmit={save} className="space-y-4" noValidate>
          <Section title={t('Shop profile')}>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {logoUrl ? <img src={assetUrl(logoUrl)} alt="" className="h-full w-full object-contain" /> : <Icon name="image" className="h-8 w-8 text-slate-300" />}
              </div>
              <div className="flex flex-wrap gap-2">
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
                <Button variant="secondary" size="sm" icon="upload" loading={logoBusy} onClick={() => logoRef.current && logoRef.current.click()}>
                  {logoUrl ? t('Change logo') : t('Upload logo')}
                </Button>
                {logoUrl && (
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={removeLogo} disabled={logoBusy}>
                    {t('Remove')}
                  </Button>
                )}
              </div>
            </div>
            <Field label={t('Shop name')} required error={errors.shopName}>
              <TextInput value={form.shopName} onChange={set('shopName')} error={errors.shopName} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Phone')} error={errors.phone}>
                <TextInput type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} />
              </Field>
              <Field label="Email" error={errors.email}>
                <TextInput type="email" value={form.email} onChange={set('email')} error={errors.email} />
              </Field>
            </div>
            <Field label={t('Address')} error={errors.address}>
              <Textarea value={form.address} onChange={set('address')} error={errors.address} />
            </Field>
          </Section>

          <Section title={t('Default GST and bank details')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Default GST %')} error={errors.defaultGstPercent}>
                <TextInput type="number" inputMode="decimal" min="0" max="100" step="any" value={form.defaultGstPercent} onChange={set('defaultGstPercent')} error={errors.defaultGstPercent} />
              </Field>
              <Field label={t('Bank name')} error={errors.bankName}>
                <TextInput value={form.bankName} onChange={set('bankName')} error={errors.bankName} />
              </Field>
              <Field label={t('Account number')} error={errors.accountNo}>
                <TextInput inputMode="numeric" value={form.accountNo} onChange={set('accountNo')} error={errors.accountNo} />
              </Field>
              <Field label="IFSC" error={errors.ifsc}>
                <TextInput value={form.ifsc} onChange={set('ifsc')} error={errors.ifsc} autoCapitalize="characters" placeholder="SBIN0001234" />
              </Field>
              <Field label="UPI ID" error={errors.upiId}>
                <TextInput value={form.upiId} onChange={set('upiId')} error={errors.upiId} autoCapitalize="none" placeholder="shop@upi" />
              </Field>
            </div>
          </Section>

          <Section title={t('Estimate')}>
            <Field label={t('Estimate prefix')} error={errors.invoicePrefix} hint={`${t('Estimates will be numbered like')} ${form.invoicePrefix || 'INV'}-0001`}>
              <TextInput value={form.invoicePrefix} onChange={set('invoicePrefix')} error={errors.invoicePrefix} autoCapitalize="characters" />
            </Field>
            <Field label={t('Terms and conditions')} error={errors.terms}>
              <Textarea value={form.terms} onChange={set('terms')} error={errors.terms} />
            </Field>
          </Section>

          <Section title={t('Working hours')}>
            <p className="text-sm text-slate-500">{t('Agents are tracked only between these hours (live tracking comes in a later update).')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Work starts')} error={errors.workStart}>
                <TextInput type="time" value={form.workStart} onChange={set('workStart')} error={errors.workStart} />
              </Field>
              <Field label={t('Work ends')} error={errors.workEnd}>
                <TextInput type="time" value={form.workEnd} onChange={set('workEnd')} error={errors.workEnd} />
              </Field>
            </div>
          </Section>

          <div className="safe-bottom sticky bottom-0 z-10 -mx-4 flex justify-end border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <Button type="submit" loading={busy}>
              {t('Save settings')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
