import { useI18n } from '../lib/i18n.jsx';
import { Button, Icon } from './ui.jsx';

// Sticky bar shown while "Select" mode is on: select-all, select-everything-matching, delete.
export default function BulkBar({ count, pageCount, total, allOnPageSelected, allSelected, busy, onTogglePage, onSelectAll, onClear, onDelete, onExit }) {
  const { t } = useI18n();
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
          <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={allOnPageSelected} onChange={onTogglePage} disabled={pageCount === 0} />
          {t('Select all on this page')}
        </label>
        <span className="text-sm text-slate-500">
          {count} {t('selected')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="danger" size="sm" icon="trash" disabled={count === 0 || busy} loading={busy} onClick={onDelete}>
            {t('Delete')} {count > 0 ? `(${count})` : ''}
          </Button>
          <Button variant="secondary" size="sm" onClick={onExit} disabled={busy}>
            {t('Cancel')}
          </Button>
        </div>
      </div>
      {allOnPageSelected && total > pageCount && !allSelected && (
        <p className="mt-1 text-xs text-slate-600">
          {t('All on this page are selected.')}{' '}
          <button type="button" onClick={onSelectAll} className="font-semibold text-brand-700 underline" disabled={busy}>
            {t('Select all')} {total} {t('matching')}
          </button>
        </p>
      )}
      {allSelected && total > pageCount && (
        <p className="mt-1 text-xs text-slate-600">
          {t('All')} {total} {t('matching items are selected.')}{' '}
          <button type="button" onClick={onClear} className="font-semibold text-brand-700 underline">
            {t('Clear selection')}
          </button>
        </p>
      )}
    </div>
  );
}

export function SelectBox({ checked, onChange, label }) {
  return (
    <label className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/95 shadow ring-1 ring-slate-300" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  );
}
