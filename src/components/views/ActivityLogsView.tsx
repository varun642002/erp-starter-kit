import React, { useState } from 'react';
import {
  History,
  ShieldCheck,
  FilePlus,
  ArrowRight,
  Boxes,
  FileText,
  Building2,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { ActivityLogsSection } from './ActivityLogsSection';

export const ActivityLogsView: React.FC = () => {
  const { addAuditLog, setCurrentView, currentUser, currentRole, currentBranchName } = useERP();

  // Compliance Note Modal
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteModule, setNoteModule] = useState<'Billing' | 'Inventory' | 'Finance' | 'Procurement' | 'Settings' | 'Administration'>('Administration');
  const [noteAction, setNoteAction] = useState('');
  const [noteDetails, setNoteDetails] = useState('');
  const [noteSeverity, setNoteSeverity] = useState<'info' | 'warning' | 'critical' | 'success'>('info');

  const handleSaveComplianceNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteAction.trim() || !noteDetails.trim()) return;

    addAuditLog(noteAction.trim(), noteModule, noteDetails.trim(), {
      severity: noteSeverity,
      entityType: 'Settings',
      newState: 'Compliance Note Logged'
    });

    setIsNoteModalOpen(false);
    setNoteAction('');
    setNoteDetails('');
    setNoteSeverity('info');
  };

  return (
    <div className="space-y-6 pb-20 relative" id="activity-logs-view">
      {/* Top Banner with Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Audit Trail & Activity Logs
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Real-time Active
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Centralized oversight ledger recording user operations across invoicing, inventory adjustments, POs, and system configurations.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsNoteModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
            id="btn-new-compliance-note"
          >
            <Plus className="w-4 h-4" />
            <span>Record Audit Note</span>
          </button>
        </div>
      </div>

      {/* Main Activity Logs Component */}
      <ActivityLogsSection showHeader={false} />

      {/* Manual Compliance Note Modal */}
      {isNoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Record Compliance / Audit Note</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Logged as {currentUser?.name || 'Administrator'} ({currentRole})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNoteModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveComplianceNote} className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Department / Module
                  </label>
                  <select
                    value={noteModule}
                    onChange={(e) => setNoteModule(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="Administration">Administration & Compliance</option>
                    <option value="Billing">Billing & Tax Invoices</option>
                    <option value="Inventory">Inventory & Warehouse</option>
                    <option value="Finance">Finance & Ledger</option>
                    <option value="Procurement">Procurement & POs</option>
                    <option value="Settings">System Settings</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Severity Level
                  </label>
                  <select
                    value={noteSeverity}
                    onChange={(e) => setNoteSeverity(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="info">Info / Routine Verification</option>
                    <option value="success">Success / Clearance</option>
                    <option value="warning">Warning / Discrepancy Flag</option>
                    <option value="critical">Critical / Incident Alert</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Action Title / Memo Summary
                </label>
                <input
                  type="text"
                  required
                  value={noteAction}
                  onChange={(e) => setNoteAction(e.target.value)}
                  placeholder="e.g., Physical Stock Recount Sign-off, GST Filing Audit Approval..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Audit Findings & Justification Details
                </label>
                <textarea
                  required
                  rows={3}
                  value={noteDetails}
                  onChange={(e) => setNoteDetails(e.target.value)}
                  placeholder="Describe the context, verified documents, approved variance thresholds, or supervisory notes..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNoteModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer"
                >
                  Commit to Audit Trail
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
