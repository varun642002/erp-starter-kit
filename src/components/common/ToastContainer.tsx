import React from 'react';
import { CheckCircle2, AlertCircle, Info, XCircle, X } from 'lucide-react';
import { useERP } from '../../context/ERPContext';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useERP();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        const icons = {
          success: <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 shrink-0" />,
          info: <Info className="h-4.5 w-4.5 text-slate-800 shrink-0" />,
          warning: <AlertCircle className="h-4.5 w-4.5 text-amber-500 shrink-0" />,
          error: <XCircle className="h-4.5 w-4.5 text-rose-500 shrink-0" />
        };

        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl transition-all dark:border-slate-800 dark:bg-slate-900 animate-in slide-in-from-bottom-5"
          >
            <div className="flex items-start gap-2.5">
              {icons[toast.type]}
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">{toast.title}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{toast.message}</p>
              </div>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
