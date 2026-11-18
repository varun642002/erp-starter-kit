import React, { useMemo, useState } from 'react';
import { BadgeIndianRupee, Calculator, FileCheck2, Landmark, MessageCircle } from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import {
  SUBSIDY_CHECKED_ON,
  SUBSIDY_DISCLAIMER,
  SUBSIDY_MACHINES,
  SUBSIDY_SCHEMES,
  SUBSIDY_SOURCES,
  SUBSIDY_STEPS,
  subsidyFor,
  type FarmerCategory
} from '../../../data/subsidyData';
import { Hero, Note, Panel, Stat, Stepper, full, type Step } from './ui';

const GROUPS = ['Tractors', 'Power tillers', 'Rotavators', 'Tillage and land preparation', 'Harvesting'] as const;

export const SubsidyTab: React.FC = () => {
  const { settings } = useERP();
  const cur = settings.currencySymbol || '₹';
  const [machineId, setMachineId] = useState('rv-7');
  const [category, setCategory] = useState<FarmerCategory>('other');
  const [price, setPrice] = useState('95000');
  const machine = SUBSIDY_MACHINES.find((m) => m.id === machineId) || SUBSIDY_MACHINES[0];
  const amount = Math.max(0, Number(price) || 0);
  const r = useMemo(() => subsidyFor(machine, amount, category), [machine, amount, category]);
  const otherToo = useMemo(() => subsidyFor(machine, amount, category === 'priority' ? 'other' : 'priority'), [machine, amount, category]);

  const message = `Hello, for the ${machine.name} at ${full(amount, cur)}, the government subsidy under the Sub-Mission on Agricultural Mechanization can be up to ${full(r.subsidy, cur)} (${Math.round(r.rate * 100)}% of the cost, limited to ${full(r.cap, cur)}) if you are approved before buying, so you would pay about ${full(r.farmerPays, cur)}. Register in the Uzhavan app or at the Agricultural Engineering office first. Acme Agro Equipment.`;

  const steps: Step[] = [
    {
      id: 'calc',
      label: 'Calculator',
      title: 'What subsidy can the farmer get?',
      hint: 'Pick the machine, its price and the type of farmer. The answer updates as you change them.',
      icon: Calculator,
      content: (
        <div className="space-y-4">
          <Panel>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs font-semibold text-slate-500 md:col-span-2">
                Machine
                <select
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                  className="mt-1 block h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {SUBSIDY_MACHINES.filter((m) => m.group === g).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Machine price ({cur})
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="mt-1 block h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ['priority', 'SC/ST, small or marginal farmer, or woman (50%)'],
                  ['other', 'Other farmer (40%)']
                ] as [FarmerCategory, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCategory(k)}
                  className={`cursor-pointer rounded-full px-4 py-2.5 text-xs font-bold ${category === k ? 'bg-indigo-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Panel>

          <Hero tone="emerald" label="Subsidy the farmer can get" value={full(r.subsidy, cur)} sub={r.cappedByLimit ? `Held to the limit of ${full(r.cap, cur)}` : `${Math.round(r.rate * 100)}% of the price`} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Farmer pays" value={full(r.farmerPays, cur)} sub={amount ? `${Math.round((r.farmerPays / amount) * 100)}% of the price` : undefined} />
            <Stat label="Limit for this machine" value={full(r.cap, cur)} sub={`Reached at a price of ${full(r.capReachedAt, cur)}`} />
          </div>
          {r.cappedByLimit && <Note tone="warn">The price is above {full(r.capReachedAt, cur)}, so the limit decides the subsidy, not the percentage.</Note>}
          {machine.note && <Note tone="warn">{machine.note}.</Note>}
          <Note>The other group would get {full(otherToo.subsidy, cur)} on this machine. Limits are the maximum permissible subsidy per machine in Annexure I of the central guidelines.</Note>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500"
          >
            <MessageCircle className="h-4 w-4" /> Share this with a customer
          </a>
        </div>
      )
    },
    {
      id: 'schemes',
      label: 'The schemes',
      title: 'Government schemes',
      hint: 'Who can get help, and what they get.',
      icon: Landmark,
      content: (
        <div className="space-y-4">
          <Note tone="warn">
            Checked on {SUBSIDY_CHECKED_ON} against the official scheme documents. {SUBSIDY_DISCLAIMER}
          </Note>
          <div className="grid gap-4 md:grid-cols-2">
            {SUBSIDY_SCHEMES.map((s) => (
              <Panel
                key={s.id}
                title={
                  <>
                    <Landmark className="h-4 w-4 shrink-0 text-violet-500" /> <span className="break-words">{s.title}</span>
                  </>
                }
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Who</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{s.who}</p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">What they get</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.benefit}</p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  {s.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-slate-400">
                  {s.asOf} ·{' '}
                  <a href={SUBSIDY_SOURCES[s.source].url} target="_blank" rel="noreferrer" className="underline">
                    {SUBSIDY_SOURCES[s.source].label}
                  </a>
                </p>
              </Panel>
            ))}
          </div>
        </div>
      )
    },
    {
      id: 'apply',
      label: 'How to apply',
      title: 'How a farmer applies',
      hint: 'The steps, in order. Approval must come before the purchase.',
      icon: FileCheck2,
      content: (
        <Panel>
          <ol className="space-y-4">
            {SUBSIDY_STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-black text-white">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">
            <BadgeIndianRupee className="h-4 w-4" /> Portals:
            <a href={SUBSIDY_SOURCES.smamPortal.url} target="_blank" rel="noreferrer" className="font-semibold underline">
              agrimachinery.nic.in
            </a>
            ·
            <a href={SUBSIDY_SOURCES.tnApply.url} target="_blank" rel="noreferrer" className="font-semibold underline">
              Tamil Nadu application guide
            </a>
          </p>
        </Panel>
      )
    }
  ];

  return <Stepper steps={steps} resetKey="subsidy" />;
};
