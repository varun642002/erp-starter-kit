import React, { useState } from 'react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { DESK_TABS_FOR_OTHERS, canSeeAllDeskTabs } from '../../utils/access';
import { BellRing, Banknote, Briefcase, Crown, DatabaseBackup, HandCoins, PackagePlus, Scale, ShieldAlert, ShieldQuestion, Sun, Truck } from 'lucide-react';
import { TodayTab } from '../desk/TodayTab';
import { OrdersTab } from '../desk/OrdersTab';
import { ChecksTab } from '../desk/ChecksTab';
import { BackupsTab } from '../desk/BackupsTab';
import { CashInHandTab } from '../desk/CashInHandTab';
import { OwedTab } from '../desk/OwedTab';
import { FollowUpTab } from '../desk/FollowUpTab';
import { BuyListTab } from '../desk/BuyListTab';
import { RankTab } from '../desk/RankTab';
import { CashCheckTab } from '../desk/CashCheckTab';
import { ClaimsTab } from '../desk/ClaimsTab';

type TabId = 'today' | 'owed' | 'hand' | 'follow' | 'buy' | 'orders' | 'rank' | 'cash' | 'claims' | 'checks' | 'backups';
const TABS: { id: TabId; label: string; hint: string; icon: React.ElementType }[] = [
  { id: 'today', label: 'Today', hint: 'The day at a glance: sales, cash, who owes you and what is running out', icon: Sun },
  { id: 'owed', label: 'Who owes me', hint: 'Money to collect, who to call first, and when the cash arrives', icon: HandCoins },
  { id: 'hand', label: 'Cash in hand', hint: 'How much cash each branch holds, and the cash handed over between branches', icon: Banknote },
  { id: 'follow', label: 'Service and follow-up', hint: 'Machines due for service, and customers due to buy again', icon: BellRing },
  { id: 'buy', label: 'Buy list', hint: 'What to order, from which supplier, and how much', icon: PackagePlus },
  { id: 'orders', label: 'Supplier orders', hint: 'Orders placed with suppliers, and what you owe them', icon: Truck },
  { id: 'rank', label: 'Customers', hint: 'Best customers, customers who stopped coming, and new ones', icon: Crown },
  { id: 'cash', label: 'Cash check', hint: 'Days the cash did not match, and days nobody closed the cash book', icon: Scale },
  { id: 'claims', label: 'Warranty claims', hint: 'Which machines and parts fail most, and which claims are waiting', icon: ShieldAlert },
  { id: 'checks', label: 'Staff checks', hint: 'Bills that were edited or deleted, and big discounts', icon: ShieldQuestion },
  { id: 'backups', label: 'Backups', hint: 'Is the data backed up, and download your own copy', icon: DatabaseBackup }
];

// The working desk: what needs doing today, one topic at a time.
export const BusinessDeskView: React.FC = () => {
  const { currentRole } = useERP();
  const { isSuperAdmin } = useAuth();
  // The Super Admin sees every tab; everyone else only Cash in hand, Buy list, Customers and Warranty claims.
  const tabs = canSeeAllDeskTabs(isSuperAdmin, currentRole) ? TABS : TABS.filter((t) => (DESK_TABS_FOR_OTHERS as readonly string[]).includes(t.id));
  const [tab, setTab] = useState<TabId>(tabs[0].id);
  const current = tabs.find((t) => t.id === tab) || tabs[0];

  return (
    <div className="space-y-4 pb-12">
      <section className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
            <Briefcase className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Business Desk</h1>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">What needs doing: money to collect, customers to call, stock to buy, cash to check and claims to chase. Pick a topic.</p>
          </div>
        </div>

        <div className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-1.5" role="tablist" aria-label="Business desk topics">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = current.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-bold transition-all ${
                  on
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/25'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{current.hint}</p>

        <div className="mt-5">
          {current.id === 'today' && <TodayTab />}
          {current.id === 'owed' && <OwedTab />}
          {current.id === 'hand' && <CashInHandTab />}
          {current.id === 'follow' && <FollowUpTab />}
          {current.id === 'buy' && <BuyListTab />}
          {current.id === 'orders' && <OrdersTab />}
          {current.id === 'rank' && <RankTab />}
          {current.id === 'cash' && <CashCheckTab />}
          {current.id === 'claims' && <ClaimsTab />}
          {current.id === 'checks' && <ChecksTab />}
          {current.id === 'backups' && <BackupsTab />}
        </div>
      </section>
    </div>
  );
};
