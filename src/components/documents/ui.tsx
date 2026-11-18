import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import type { ApiScope } from '../../services/apiClient';
import type { DocStatus } from '../../services/documentApi';

export const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-base text-slate-900 placeholder:text-slate-400 sm:py-1.5 sm:text-xs focus:border-indigo-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
export const LABEL = 'mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400';
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-xs sm:px-3 sm:py-2 sm:text-xs hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600';
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 sm:px-2.5 sm:py-1.5 sm:text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';
export const BTN_DANGER =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2.5 text-sm font-semibold text-white sm:px-3 sm:py-2 sm:text-xs hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50';
export const CARD = 'rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900';
export const ICON_BTN =
  'rounded-md p-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 sm:p-1.5 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white';

const STATUS_STYLES: Record<DocStatus, string> = {
  Draft: 'text-slate-700 dark:text-slate-300',
  Sent: 'text-sky-700 dark:text-sky-300',
  Issued: 'text-sky-700 dark:text-sky-300',
  Accepted: 'text-emerald-700 dark:text-emerald-300',
  Paid: 'text-emerald-700 dark:text-emerald-300',
  'Partially Paid': 'text-amber-700 dark:text-amber-300',
  Rejected: 'text-rose-700 dark:text-rose-300',
  Expired: 'text-orange-700 dark:text-orange-300',
  Converted: 'text-indigo-700 dark:text-indigo-300',
  Cancelled: 'text-rose-700 dark:text-rose-300'
};

export const StatusBadge: React.FC<{ status: DocStatus }> = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap text-[11px] font-bold ${STATUS_STYLES[status]}`}>
    {status}
  </span>
);

export function useApiScope() {
  const { currentRole, selectedBranchId } = useERP();
  const { assignedBranchId } = useAuth();
  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';
  const scope: ApiScope = useMemo(
    () => ({
      role: currentRole,
      branchId: isOwner ? (selectedBranchId === 'all' ? 'branch-1' : selectedBranchId) : assignedBranchId
    }),
    [currentRole, isOwner, selectedBranchId, assignedBranchId]
  );
  return { scope, isOwner, branchParam: isOwner ? selectedBranchId : undefined, assignedBranchId };
}

export const Modal: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'xl';
  actions?: React.ReactNode;
}> = ({ title, subtitle, onClose, children, size = 'md', actions }) =>
  // Drawn at the top of the page so the side menu and header can never sit over it
  createPortal(
  <div className={`no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs ${size === 'xl' ? 'p-0 sm:p-4' : 'p-3 sm:p-4'}`}>
    <div
      className={`flex w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 ${
        size === 'xl'
          ? 'h-[100dvh] max-h-[100dvh] max-w-5xl rounded-none sm:h-auto sm:max-h-[94vh] sm:rounded-2xl'
          : `max-h-[94dvh] rounded-2xl ${size === 'md' ? 'max-w-xl' : 'max-w-md'}`
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  </div>,
  document.body
);
