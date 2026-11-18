import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckSquare,
  X,
  RefreshCw,
  Archive,
  ArchiveRestore,
  Printer,
  Download,
  ChevronDown,
  Tag,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Send,
  Layers
} from 'lucide-react';

export interface StatusOption {
  value: string;
  label: string;
  badgeClass?: string;
  icon?: React.ReactNode;
}

export interface BulkActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  itemName?: string; // e.g. "material", "order", "invoice"
  isArchivedView?: boolean;
  onClearSelection: () => void;
  onSelectAll?: () => void;
  // Status changing
  statusOptions?: StatusOption[];
  onApplyStatus?: (status: string) => void;
  // Archiving
  onArchive?: () => void;
  onRestore?: () => void;
  // Printing
  onPrintSelection?: () => void;
  // Exporting
  onExportSelection?: () => void;
  // Additional custom actions
  customActions?: {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'warning' | 'emerald' | 'danger';
  }[];
}

export const BulkActionToolbar: React.FC<BulkActionToolbarProps> = ({
  selectedCount,
  totalCount,
  itemName = 'item',
  isArchivedView = false,
  onClearSelection,
  onSelectAll,
  statusOptions = [],
  onApplyStatus,
  onArchive,
  onRestore,
  onPrintSelection,
  onExportSelection,
  customActions = []
}) => {
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [showConfirmArchive, setShowConfirmArchive] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-24 left-1/2 z-40 md:bottom-6 -translate-x-1/2 w-[calc(100%-2rem)] max-w-4xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3 px-4 text-white shadow-2xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95">
          {/* Left: Selection Counter & Clear */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-slate-800/30 border border-slate-800/40 px-3 py-1.5 text-xs font-semibold text-slate-300">
              <CheckSquare className="h-4 w-4 text-slate-400" />
              <span>
                <strong className="text-white font-mono text-sm">{selectedCount}</strong> {itemName}
                {selectedCount > 1 ? 's' : ''} selected
              </span>
            </div>

            {onSelectAll && selectedCount < totalCount && (
              <button
                type="button"
                onClick={onSelectAll}
                className="hidden sm:inline-flex text-xs font-medium text-slate-300 hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
              >
                Select all {totalCount}
              </button>
            )}

            <button
              type="button"
              onClick={onClearSelection}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer"
              title="Deselect all (Esc)"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Deselect</span>
            </button>
          </div>

          {/* Right: Bulk Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Change Dropdown */}
            {statusOptions.length > 0 && onApplyStatus && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors active:scale-98 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                  <span>Change Status</span>
                  <ChevronDown className="h-3 w-3 text-slate-400 ml-0.5" />
                </button>

                {isStatusDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsStatusDropdownOpen(false)}
                    />
                    <div className="absolute right-0 bottom-full mb-2 z-20 min-w-[200px] rounded-xl border border-slate-700 bg-slate-800 p-1.5 shadow-xl animate-in fade-in zoom-in-95">
                      <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700/60 pb-1.5 mb-1">
                        Apply Status ({selectedCount} items)
                      </p>
                      <div className="space-y-0.5">
                        {statusOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              onApplyStatus(opt.value);
                              setIsStatusDropdownOpen(false);
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800/30 hover:text-white transition-colors cursor-pointer text-left"
                          >
                            <span className="flex items-center gap-2">
                              {opt.icon}
                              {opt.label}
                            </span>
                            {opt.badgeClass && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${opt.badgeClass}`}>
                                {opt.value}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Custom Extra Actions (e.g. Confirm, Convert) */}
            {customActions.map((action) => {
              const variantClasses =
                action.variant === 'emerald'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : action.variant === 'primary'
                  ? 'bg-slate-800 hover:bg-slate-900 text-white'
                  : action.variant === 'warning'
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : action.variant === 'danger'
                  ? 'bg-rose-700 hover:bg-rose-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200';

              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors active:scale-98 cursor-pointer ${variantClasses}`}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              );
            })}

            {/* Print Selection */}
            {onPrintSelection && (
              <button
                type="button"
                onClick={onPrintSelection}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors active:scale-98 cursor-pointer"
                title="Generate printable batch summary / slips"
              >
                <Printer className="h-3.5 w-3.5 text-sky-400" />
                <span className="hidden sm:inline">Print Selection</span>
                <span className="sm:hidden">Print</span>
              </button>
            )}

            {/* Export Selection CSV */}
            {onExportSelection && (
              <button
                type="button"
                onClick={onExportSelection}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors active:scale-98 cursor-pointer"
                title="Export selected items to CSV"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sm:hidden">Export</span>
              </button>
            )}

            {/* Archive / Restore Button */}
            {!isArchivedView && onArchive && (
              <div className="relative">
                {showConfirmArchive ? (
                  <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-700/80 rounded-xl px-2.5 py-1">
                    <span className="text-[11px] text-rose-300 font-medium">Confirm?</span>
                    <button
                      type="button"
                      onClick={() => {
                        onArchive();
                        setShowConfirmArchive(false);
                      }}
                      className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-500 cursor-pointer"
                    >
                      Yes, Archive
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConfirmArchive(false)}
                      className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConfirmArchive(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:border-rose-700/80 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-rose-300 transition-colors active:scale-98 cursor-pointer"
                    title="Archive selected items"
                  >
                    <Archive className="h-3.5 w-3.5 text-slate-400" />
                    <span>Archive</span>
                  </button>
                )}
              </div>
            )}

            {isArchivedView && onRestore && (
              <button
                type="button"
                onClick={onRestore}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors active:scale-98 cursor-pointer"
                title="Restore selected items from archive"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                <span>Restore ({selectedCount})</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
