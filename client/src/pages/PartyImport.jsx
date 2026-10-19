import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFromApi, saveBlob } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { toCsv } from '../lib/format.js';
import { Badge, Button, ErrorBox, Icon, PageHeader, Select, useToast } from '../components/ui.jsx';

const STATUS_TONE = { ok: 'green', update: 'blue', duplicate: 'amber', error: 'red' };

function StatCard({ label, value, tone }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <Badge tone={tone}>{label}</Badge>
    </div>
  );
}

export default function PartyImport() {
  const { t } = useI18n();
  const toast = useToast();
  const fileRef = useRef(null);
  const [step, setStep] = useState(1); // 1 upload, 2 map, 3 result
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null); // preview response
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState('skip');
  const [check, setCheck] = useState(null); // validate response
  const [done, setDone] = useState(null); // commit response

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(1);
    setFile(null);
    setCheck(null);
    setDone(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    run(async () => {
      const form = new FormData();
      form.append('file', f);
      const r = await api.upload('/parties/import/preview', form);
      setFile(r);
      setMapping(r.suggestedMapping);
      setCheck(null);
      setStep(2);
    });
  };

  const body = () => ({ rows: file.rows, mapping, mode });

  const validate = () =>
    run(async () => {
      if (!mapping.name) throw new Error(t('Please choose the column that holds the party name'));
      setCheck(await api.post('/parties/import/validate', body()));
    });

  const commit = () =>
    run(async () => {
      const r = await api.post('/parties/import/commit', body());
      setDone(r);
      setStep(3);
      toast.success(`${r.inserted + r.updated} ${t('parties imported')}`);
    });

  const issuesCsv = (rows, name) => {
    const data = [['Row', 'Name', 'Status', 'Problem'], ...rows.map((r) => [r.row, r.name, r.status, r.message])];
    saveBlob(new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }), name);
  };

  const s = check && check.summary;
  const problemRows = check ? check.rows.filter((r) => r.status !== 'ok' || r.message) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('Import parties')}
        subtitle={t('Upload a CSV or Excel file with your retailers')}
        actions={
          <Link to="/parties" className="btn btn-secondary">
            {t('Back to parties')}
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      )}

      {step === 1 && (
        <div className="card p-6">
          <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-4 py-10 text-center">
            <Icon name="file" className="mb-3 h-10 w-10 text-slate-400" />
            <p className="font-semibold text-slate-800">{t('Choose a .csv or .xlsx file')}</p>
            <p className="mb-4 mt-1 text-sm text-slate-500">{t('First row must have column names. Max 5000 rows.')}</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={pick} className="hidden" id="import-file" />
            <Button icon="upload" loading={busy} onClick={() => fileRef.current && fileRef.current.click()}>
              {t('Choose file')}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>{t('Not sure about the format?')}</span>
            <Button variant="secondary" size="sm" icon="download" onClick={() => downloadFromApi('/parties/import/template', 'parties-import-template.csv').catch((e) => toast.error(e.message))}>
              {t('Download sample template')}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && file && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="text-sm text-slate-500">{t('File')}</p>
            <p className="font-semibold text-slate-900">
              {file.fileName} · {file.totalRows} {t('rows')}
            </p>
          </div>

          <div className="card p-4">
            <h2 className="mb-1 font-semibold text-slate-900">{t('Match your columns')}</h2>
            <p className="mb-4 text-sm text-slate-500">{t('We guessed the matching. Fix anything that looks wrong.')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {file.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </span>
                  <Select
                    value={mapping[f.key] || ''}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, [f.key]: e.target.value || null }));
                      setCheck(null);
                    }}
                  >
                    <option value="">{t('— Skip —')}</option>
                    {file.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 font-semibold text-slate-900">{t('If a party already exists (same phone number)')}</h2>
            <div className="space-y-2">
              {[
                ['skip', t('Skip it (keep the existing one)')],
                ['update', t('Update the existing party with the new details')],
              ].map(([v, label]) => (
                <label key={v} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === v}
                    onChange={() => {
                      setMode(v);
                      setCheck(null);
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {s && (
            <div className="card p-4">
              <h2 className="mb-3 font-semibold text-slate-900">{t('Check result')}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label={t('Will add')} value={s.ok} tone="green" />
                <StatCard label={t('Will update')} value={s.update} tone="blue" />
                <StatCard label={t('Duplicates')} value={s.duplicate} tone="amber" />
                <StatCard label={t('Errors')} value={s.error} tone="red" />
              </div>
              {problemRows.length > 0 && (
                <>
                  <div className="mb-2 mt-4 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{t('Rows that need attention')}</p>
                    <Button variant="secondary" size="sm" icon="download" onClick={() => issuesCsv(problemRows, 'party-import-errors.csv')}>
                      {t('Error report')}
                    </Button>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">{t('Row')}</th>
                          <th className="px-3 py-2">{t('Name')}</th>
                          <th className="px-3 py-2">{t('Problem')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {problemRows.slice(0, 200).map((r) => (
                          <tr key={r.row}>
                            <td className="px-3 py-2 align-top">{r.row}</td>
                            <td className="px-3 py-2 align-top">{r.name || '—'}</td>
                            <td className="px-3 py-2 align-top">
                              <Badge tone={STATUS_TONE[r.status]} className="mr-1">
                                {r.status}
                              </Badge>
                              {r.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {problemRows.length > 200 && <p className="mt-1 text-xs text-slate-500">{t('Showing the first 200. Download the error report for all rows.')}</p>}
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={reset}>
              {t('Start over')}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" loading={busy} onClick={validate}>
                {t('Check file')}
              </Button>
              <Button loading={busy} disabled={!s || s.ok + s.update === 0} onClick={commit}>
                {t('Import now')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && done && (
        <div className="card p-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <h2 className="text-lg font-bold text-slate-900">{t('Import finished')}</h2>
          <div className="mx-auto my-4 grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label={t('Added')} value={done.inserted} tone="green" />
            <StatCard label={t('Updated')} value={done.updated} tone="blue" />
            <StatCard label={t('Skipped')} value={done.skippedDuplicates} tone="amber" />
            <StatCard label={t('Failed')} value={done.failed} tone="red" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {done.issues.length > 0 && (
              <Button variant="secondary" icon="download" onClick={() => issuesCsv(done.issues, 'party-import-report.csv')}>
                {t('Error report')}
              </Button>
            )}
            <Button variant="secondary" onClick={reset}>
              {t('Import another file')}
            </Button>
            <Link to="/parties" className="btn btn-primary">
              {t('View parties')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
