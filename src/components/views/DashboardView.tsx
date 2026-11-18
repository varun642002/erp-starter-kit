import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { canSeePredictions } from '../../utils/access';
import { BusinessOwnerDashboard } from '../dashboard/BusinessOwnerDashboard';
import { BranchPersonDashboard } from '../dashboard/BranchPersonDashboard';
import { AccountantDashboard } from '../dashboard/AccountantDashboard';
import { RealTimeKPISection } from '../dashboard/RealTimeKPISection';
import { PendingFollowUpsModule } from '../dashboard/PendingFollowUpsModule';
import { CloseDayReminder } from '../dashboard/CloseDayReminder';

const PredictionsLink: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-left hover:bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30"
  >
    <span>
      <span className="block text-sm font-bold text-violet-900 dark:text-violet-200">Predictions have their own page now</span>
      <span className="block text-[11px] text-violet-700/80 dark:text-violet-300/80">Machines expected each month next year, products to buy, rain and season, customers and subsidies.</span>
    </span>
    <ArrowRight className="h-4 w-4 shrink-0 text-violet-600" />
  </button>
);

export const DashboardView: React.FC = () => {
  const { currentRole, expiringWarrantiesCount, setCurrentView } = useERP();
  const { isSuperAdmin } = useAuth();

  const isBranchUser = currentRole === 'Branch Person' || currentRole === 'Branch Manager';
  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';

  // If user is Branch Person, show strictly the simple branch dashboard
  if (isBranchUser) {
    return (
      <div className="space-y-6 pb-12">
        <CloseDayReminder />
        {/* Branch Dashboard Component */}
        <BranchPersonDashboard />
        {canSeePredictions(isSuperAdmin, currentRole) && <PredictionsLink onOpen={() => setCurrentView('predictions')} />}
      </div>
    );
  }

  // Business Owner View
  return (
    <div className="space-y-6 pb-12">
      <CloseDayReminder />
      {/* Warranty Expiration Alert Widget */}
      {expiringWarrantiesCount > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 shadow-2xs dark:border-amber-800/80 dark:bg-amber-950/40">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/20 p-2 text-amber-700 dark:text-amber-300 shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-900 dark:text-amber-100 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                Agro Machinery Warranty Expiration Notice: {expiringWarrantiesCount} Unit{expiringWarrantiesCount > 1 ? 's' : ''} Expiring Soon
              </h4>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                Proactively notify farmers and equipment dealers across regional branches to schedule inspections.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentView('warranties')}
            className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 shadow-2xs cursor-pointer transition-colors shrink-0"
          >
            Review Warranties & Alerts
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Real-Time Key Performance Indicators (Live Context Sync) */}
      <RealTimeKPISection />

      {/* Forecasts: sales, stock run-out, machines and collections */}
      {isOwner && canSeePredictions(isSuperAdmin, currentRole) && <PredictionsLink onOpen={() => setCurrentView('predictions')} />}

      {/* Pending Follow-ups Module (Past-due Invoices & Debtor Management) */}
      <PendingFollowUpsModule />

      {/* Business Owner Executive Dashboard (with Trajectory & Master Pricing) */}
      {currentRole === 'Accountant' ? (
        <AccountantDashboard />
      ) : (
        <BusinessOwnerDashboard />
      )}
    </div>
  );
};
