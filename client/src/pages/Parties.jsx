import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useDebounce from '../lib/useDebounce.js';
import useFetch from '../lib/useFetch.js';
import { money } from '../lib/format.js';
import PartyModal from '../components/PartyModal.jsx';
import { Badge, Button, EmptyState, ErrorBox, Icon, PageHeader, Pagination, SearchBox, Select, Skeleton, useConfirm, useToast } from '../components/ui.jsx';
import BulkBar, { SelectBox } from '../components/BulkBar.jsx';
import useBulkSelect from '../lib/useBulkSelect.js';

const LIMIT = 20;

export default function Parties() {
  const { t } = useI18n();
  const { isAdmin, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [agentId, setAgentId] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState({ open: false, party: null });
  const dq = useDebounce(q);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [dq, area, agentId]);

  // "/parties?new=1" (from the dashboard) opens the add form straight away
  useEffect(() => {
    if (isAdmin && params.get('new')) {
      setModal({ open: true, party: null });
      setParams({}, { replace: true });
    }
  }, [isAdmin, params, setParams]);

  const list = useFetch(() => api.get('/parties', { q: dq, area, agentId, page, limit: LIMIT }), [dq, area, agentId, page], { live: true });
  const areas = useFetch(() => api.get('/parties/areas'), []);
  const agents = useFetch(() => (isAdmin ? api.get('/agents') : Promise.resolve({ items: [] })), [isAdmin]);

  const items = list.data ? list.data.items : [];
  const total = list.data ? list.data.total : 0;
  const pageIds = useMemo(() => items.map((p) => p.id), [items]);
  const bulk = useBulkSelect(pageIds, `${dq}|${area}|${agentId}`);
  const allSelected = total > 0 && bulk.sel.size >= total;

  const selectAllMatching = async () => {
    setBusy(true);
    try {
      const r = await api.get('/parties/ids', { q: dq, area, agentId });
      bulk.setSel(new Set(r.ids));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    const n = bulk.sel.size;
    const ok = await confirm({
      title: `${t('Delete')} ${n} ${t('parties')}?`,
      message: t('These parties will be removed from your list. Old orders and estimates stay intact.'),
      confirmText: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post('/parties/bulk-delete', { ids: Array.from(bulk.sel) });
      toast.success(`${r.deleted} ${t('parties deleted')}`);
      bulk.exit();
      if (page > 1 && n >= items.length) setPage(1);
      list.reload();
      areas.reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => setModal({ open: false, party: null });
  const saved = () => {
    closeModal();
    list.reload();
    areas.reload();
  };

  return (
    <div>
      <PageHeader
        title={t('Parties')}
        subtitle={isAdmin ? t('Retailers and customers you sell to') : t('All parties · take orders for anyone')}
        actions={
          isAdmin && (
            <>
              {items.length > 0 && (
                <Button variant="secondary" icon="check" onClick={() => (bulk.on ? bulk.exit() : bulk.setOn(true))}>
                  {t('Select')}
                </Button>
              )}
              <Link to="/parties/import" className="btn btn-secondary">
                <Icon name="upload" className="h-4 w-4" /> {t('Import')}
              </Link>
              <Button icon="plus" onClick={() => setModal({ open: true, party: null })}>
                {t('Add party')}
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <SearchBox value={q} onChange={setQ} placeholder={t('Search name, phone, area')} />
        </div>
        <Select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">{t('All areas')}</option>
          {(areas.data ? areas.data.items : []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        {!isAdmin && user && (
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{t('All parties')}</option>
            <option value={String(user.id)}>{t('My parties')}</option>
          </Select>
        )}
        {isAdmin && (
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{t('All agents')}</option>
            <option value="none">{t('No agent')}</option>
            {(agents.data ? agents.data.items : []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {bulk.on && (
        <BulkBar
          count={bulk.sel.size}
          pageCount={items.length}
          total={total}
          allOnPageSelected={bulk.allOnPage}
          allSelected={allSelected}
          busy={busy}
          onTogglePage={bulk.togglePage}
          onSelectAll={selectAllMatching}
          onClear={() => bulk.setSel(new Set())}
          onDelete={deleteSelected}
          onExit={bulk.exit}
        />
      )}

      <ErrorBox error={list.error} onRetry={list.reload} />

      {list.loading && !list.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {list.data && items.length === 0 && (
        <EmptyState
          icon="users"
          title={t('No parties found')}
          text={dq || area || agentId ? t('Try a different search or filter.') : isAdmin ? t('Add your first party or import a list from Excel.') : t('No parties added yet.')}
          action={
            isAdmin && !dq && !area && !agentId ? (
              <Button icon="plus" onClick={() => setModal({ open: true, party: null })}>
                {t('Add party')}
              </Button>
            ) : null
          }
        />
      )}

      {items.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {total} {t('parties')}
          </p>
          <div className={`grid gap-3 sm:grid-cols-2 ${list.loading ? 'opacity-60' : ''}`}>
            {items.map((p) => (
              <div key={p.id} className={`card flex flex-col transition hover:shadow-md ${bulk.sel.has(p.id) ? 'ring-2 ring-brand-700' : ''}`}>
                <button type="button" onClick={() => (bulk.on ? bulk.toggle(p.id) : setModal({ open: true, party: p }))} className="p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    {bulk.on && <SelectBox checked={bulk.sel.has(p.id)} onChange={() => bulk.toggle(p.id)} label={p.name} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{p.name}</p>
                      <p className="truncate text-sm text-slate-500">{[p.ownerName, p.phone].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    {p.currentBalance > 0 && <Badge tone={p.creditLimit > 0 && p.currentBalance > p.creditLimit ? 'red' : 'amber'}>{money(p.currentBalance)}</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.area && <Badge tone="blue">{p.area}</Badge>}
                    {isAdmin && (p.agentName ? <Badge tone="brand">{p.agentName}</Badge> : <Badge>{t('No agent')}</Badge>)}
                  </div>
                </button>
                <div className="border-t border-slate-100 px-4 py-2">
                  <Link to={`/orders/new?party=${p.id}`} className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-brand-700">
                    <Icon name="cart" className="h-4 w-4" /> {t('Take order')}
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
        </>
      )}

      <PartyModal
        open={modal.open}
        party={modal.party}
        isAdmin={isAdmin}
        areas={areas.data ? areas.data.items : []}
        agents={(agents.data ? agents.data.items : []).filter((a) => a.isActive)}
        onClose={closeModal}
        onSaved={saved}
      />
    </div>
  );
}
