import React from 'react';
import { BellRing, Wrench } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useApiScope } from '../documents/ui';
import { analyticsApi } from '../../services/analyticsApi';
import { Hero, Note, Panel, Stat, Stepper, TabState, Tip, WhatsAppButton, shortDate, useTabData, type Step } from '../dashboard/predictions/ui';

// Customers to call or message: machines due for service or at the end of warranty, and people due to buy again.
export const FollowUpTab: React.FC = () => {
  const { selectedBranchId } = useERP();
  const { scope, branchParam } = useApiScope();
  const { data, loading, error, reload } = useTabData(() => analyticsApi.customers(scope, branchParam), [scope, branchParam, selectedBranchId]);

  const steps: Step[] = [];
  if (data) {
    const s = data.service;
    const r = data.repeat;
    steps.push({
      id: 'service',
      label: 'Service due',
      title: 'Machines that need a service call',
      hint: 'Delivered 3, 6 or 12 months ago, or with the warranty about to end. A message brings them back.',
      icon: Wrench,
      content: (
        <div className="space-y-4">
          <Hero tone="emerald" label="Calls to make" value={s.calls.length} sub="service checks and warranty endings coming up" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Service jobs, last 90 days" value={s.jobsLast90} sub={`${s.jobsPrev90} in the 90 days before`} />
            <Stat label="Open service jobs" value={s.openJobs} />
            {s.topModels.slice(0, 2).map((m) => (
              <Stat key={m.model} label="Most serviced" value={m.model} sub={`${m.jobs} job${m.jobs === 1 ? '' : 's'}`} />
            ))}
          </div>
          {s.calls.length === 0 ? (
            <Note>No warranty ends in the next 60 days, and no machine is at its 3, 6 or 12 month mark right now. {s.basis}.</Note>
          ) : (
            <Panel>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {s.calls.slice(0, 25).map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{c.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {c.machine}
                        {c.serial ? ` · ${c.serial}` : ''}
                      </p>
                      <p className={`text-[11px] font-bold ${c.kind === 'Warranty ending' ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
                        {c.kind === 'Warranty ending' ? `Warranty ends ${shortDate(c.date)} (${c.daysAway} days)` : `Delivered ${c.daysAway} days ago: service check due`}
                      </p>
                    </div>
                    <WhatsAppButton phone={c.phone} text={c.message} label="Message" />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Tip>A short "your machine is due for service" message also reminds them to buy blades, bearings and oil from you.</Tip>
        </div>
      )
    });

    steps.push({
      id: 'again',
      label: 'Buy again',
      title: 'Customers due to buy again',
      hint: 'People who buy regularly and are now later than usual.',
      icon: BellRing,
      content:
        r.items.length === 0 ? (
          <Note>No one is overdue yet. This list builds up as customers buy more than once with their name saved on the bill. {r.basis}.</Note>
        ) : (
          <Panel>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {r.items.map((x) => (
                <li key={x.customerId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{x.name}</p>
                    <p className="text-[11px] text-slate-500">
                      Usually buys every {x.usualGapDays} days; last bought {x.daysSinceLast} days ago ({shortDate(x.lastPurchase)})
                    </p>
                    {x.usualItems.length > 0 && <p className="text-[11px] text-slate-400">Usually: {x.usualItems.join(', ')}</p>}
                  </div>
                  <WhatsAppButton phone={x.phone} text={x.message} label="Remind" />
                </li>
              ))}
            </ul>
          </Panel>
        )
    });
  }

  return (
    <TabState loading={loading} error={error} hasData={!!data} reload={reload}>
      {data && <Stepper steps={steps} resetKey={`follow-${scope.branchId}-${branchParam}`} />}
    </TabState>
  );
};
