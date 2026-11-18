import React, { useMemo } from 'react';
import { ArrowRight, ClipboardList, Cog, Hammer, Tractor } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { Good, Hero, Note, Panel, Stat, Stepper, Tip, compact, shortDate, type Step } from '../dashboard/predictions/ui';

const OPEN = ['Submitted', 'Approved', 'In Repair'];
const STATUS_STYLE: Record<string, string> = {
  Submitted: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  Approved: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  'In Repair': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  Resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  Rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
};
const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000));

// What the warranty claims say: which machines and parts fail most, what they cost, and which are still open.
export const ClaimsTab: React.FC = () => {
  const { warranties, settings, setCurrentView, selectedBranchId } = useERP();
  const cur = settings.currencySymbol || '₹';

  const view = useMemo(() => {
    const claims = warranties
      .filter((w) => selectedBranchId === 'all' || w.branchId === selectedBranchId)
      .flatMap((w) => (w.serviceRecords || []).map((r) => ({ ...r, warranty: w })));
    const open = claims.filter((c) => OPEN.includes(c.status)).sort((a, b) => a.claimDate.localeCompare(b.claimDate));
    const cost = claims.reduce((s, c) => s + (Number(c.claimCost) || 0), 0);
    const byMachine = new Map<string, { claims: number; cost: number; machines: Set<string> }>();
    const byPart = new Map<string, number>();
    const byStatus = new Map<string, number>();
    for (const c of claims) {
      const k = c.warranty.productName || 'Unknown machine';
      const m = byMachine.get(k) || { claims: 0, cost: 0, machines: new Set<string>() };
      m.claims++;
      m.cost += Number(c.claimCost) || 0;
      m.machines.add(c.warranty.id);
      byMachine.set(k, m);
      for (const p of c.replacedParts || []) {
        const key = p.trim();
        if (key) byPart.set(key, (byPart.get(key) || 0) + 1);
      }
      byStatus.set(c.status, (byStatus.get(c.status) || 0) + 1);
    }
    return {
      claims,
      open,
      cost,
      machines: [...byMachine.entries()].map(([name, v]) => ({ name, claims: v.claims, cost: v.cost, units: v.machines.size })).sort((a, b) => b.claims - a.claims || b.cost - a.cost).slice(0, 10),
      parts: [...byPart.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 12),
      byStatus: [...byStatus.entries()]
    };
  }, [warranties, selectedBranchId]);

  const steps: Step[] = [
    {
      id: 'summary',
      label: 'Summary',
      title: 'Warranty claims at a glance',
      hint: 'Every claim logged in the Warranty page.',
      icon: ClipboardList,
      content: (
        <div className="space-y-4">
          <Hero tone={view.open.length ? 'amber' : 'emerald'} label="Claims still open" value={view.open.length} sub={`${view.claims.length} claim${view.claims.length === 1 ? '' : 's'} in all · ${compact(view.cost, cur)} spent on them`} />
          {view.claims.length === 0 ? (
            <Note>No warranty claims have been logged yet. Add one from a machine's row in the Warranty page.</Note>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Total cost" value={compact(view.cost, cur)} sub="across all claims" />
              <Stat label="Average claim" value={compact(view.cost / Math.max(1, view.claims.length), cur)} />
              {view.byStatus.map(([s, n]) => (
                <div key={s} className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[s] || 'bg-slate-100 text-slate-700'}`}>{s}</span>
                  <p className="mt-1.5 text-2xl font-black tabular-nums text-slate-900 dark:text-white">{n}</p>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setCurrentView('warranties')} className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
            Open the Warranty page to log or update a claim <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )
    },
    {
      id: 'machines',
      label: 'Machines',
      title: 'Which machines fail most',
      hint: 'Machines with the most claims, and what those claims cost.',
      icon: Tractor,
      content:
        view.machines.length === 0 ? (
          <Note>No claims to compare yet.</Note>
        ) : (
          <Panel>
            <ul className="space-y-3.5">
              {(() => {
                const max = Math.max(1, ...view.machines.map((m) => m.claims));
                return view.machines.map((m) => (
                  <li key={m.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-white">{m.name}</p>
                      <p className="shrink-0 text-right text-sm font-black tabular-nums text-slate-900 dark:text-white">
                        {m.claims} <span className="text-[11px] font-medium text-slate-500">claim{m.claims === 1 ? '' : 's'}</span>
                      </p>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-orange-400" style={{ width: `${Math.max(4, (m.claims / max) * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {m.units} machine{m.units === 1 ? '' : 's'} · {compact(m.cost, cur)} spent
                    </p>
                  </li>
                ));
              })()}
            </ul>
          </Panel>
        )
    },
    {
      id: 'parts',
      label: 'Parts',
      title: 'Which parts get replaced most',
      hint: 'From the "replaced parts" written on each claim.',
      icon: Cog,
      content:
        view.parts.length === 0 ? (
          <Note>No replaced parts have been written on any claim yet. Add them when you log a claim, and the weak parts will show up here.</Note>
        ) : (
          <div className="space-y-4">
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.parts.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-3 py-2.5">
                    <p className="min-w-0 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{p.name}</p>
                    <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-extrabold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">{p.n}×</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Tip>If the same part keeps failing, raise it with the company, and keep a few in stock.</Tip>
          </div>
        )
    },
    {
      id: 'open',
      label: 'Open claims',
      title: 'Claims still waiting',
      hint: 'Oldest first. Chase these so customers are not left waiting.',
      icon: Hammer,
      content:
        view.open.length === 0 ? (
          <Good>No claim is waiting</Good>
        ) : (
          <Panel>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {view.open.slice(0, 20).map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{c.warranty.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {c.warranty.productName} · {c.warranty.serialNumber}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[c.status] || ''}`}>{c.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{c.issueDescription}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    Open {daysSince(c.claimDate)} days (since {shortDate(c.claimDate)})
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )
    }
  ];

  return <Stepper steps={steps} resetKey={`claims-${selectedBranchId}`} />;
};
