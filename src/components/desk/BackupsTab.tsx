import React, { useState } from 'react';
import { CheckCircle2, Database, Download, Loader2, XCircle } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { deskApi } from '../../services/deskApi';
import { downloadSqlDatabaseBackup } from '../../services/api';
import { Hero, Note, Panel, Stepper, TabState, Tip, useTabData, type Step } from '../dashboard/predictions/ui';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '-');
const ago = (iso: string | null) => {
  if (!iso) return null;
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
};

// Is the data safe? The nightly database backups, and a download of the whole database.
export const BackupsTab: React.FC = () => {
  const { showToast } = useERP();
  const { scope } = useApiScope();
  const { data, loading, error, reload } = useTabData(() => deskApi.backups(scope), [scope]);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      showToast('Preparing the backup', 'Building the full database file. This can take a minute.', 'info');
      await downloadSqlDatabaseBackup();
      showToast('Backup downloaded', 'The .sql file was saved to your downloads.', 'success');
    } catch (e: any) {
      showToast('Could not download', e?.message || 'Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const hoursOld = data?.lastGoodAt ? (Date.now() - new Date(data.lastGoodAt).getTime()) / 3_600_000 : null;
  const stale = hoursOld !== null && hoursOld > 36;

  const steps: Step[] = [];
  if (data) {
    steps.push({
      id: 'status',
      label: 'Nightly backups',
      title: 'Is the data backed up?',
      hint: 'The database is backed up automatically every night and kept for 14 days.',
      icon: Database,
      content: (
        <div className="space-y-4">
          {data.available ? (
            <>
              <Hero tone={stale || !data.lastGoodAt ? 'amber' : 'emerald'} label="Last good backup" value={data.lastGoodAt ? ago(data.lastGoodAt) || '-' : 'None found'} sub={data.lastGoodAt ? when(data.lastGoodAt) : 'No successful backup in the latest list'} />
              {stale && <Note tone="warn">The last good backup is more than a day and a half old. Check the database in Google Cloud.</Note>}
              <Panel title="Latest backups">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.runs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {r.status === 'SUCCESSFUL' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                        {when(r.at)}
                      </p>
                      <span className="text-[11px] text-slate-500">{r.status === 'SUCCESSFUL' ? (r.type === 'ON_DEMAND' ? 'on demand' : 'automatic') : r.error || r.status}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          ) : (
            <Note tone="warn">{data.note}</Note>
          )}
          <Tip title="What a backup covers">Every sale, customer, stock figure and payment in the database. The database can also be rewound to any minute in the last few days if something is deleted by mistake.</Tip>
        </div>
      )
    });

    steps.push({
      id: 'download',
      label: 'Download a copy',
      title: 'Keep your own copy',
      hint: 'A full file you can save on your computer or a drive, as a second safety net.',
      icon: Download,
      content: (
        <div className="space-y-4">
          <Panel>
            <p className="text-sm text-slate-600 dark:text-slate-300">Downloads every table as one .sql file. Do this now and then (for example every month), and keep the file somewhere safe. It contains all your customer and sales data, so do not share it.</p>
            <button type="button" onClick={download} disabled={busy} className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download the full backup (.sql)
            </button>
          </Panel>
        </div>
      )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && <Stepper steps={steps} resetKey="backups" />}
    </TabState>
  );
};
