import React from 'react';
import {
  X,
  Bell,
  CheckCheck,
  AlertTriangle,
  FileText,
  Boxes,
  Clock,
  ArrowRight
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';

export const NotificationDrawer: React.FC = () => {
  const {
    isNotificationsOpen,
    setIsNotificationsOpen,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    setCurrentView
  } = useERP();

  if (!isNotificationsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Attention & Alerts</h2>
              <p className="text-[11px] text-slate-500">Real-time business notifications</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={markAllNotificationsRead}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
              title="Mark all as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark Read</span>
            </button>
            <button
              onClick={() => setIsNotificationsOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-xs text-slate-400">No active notifications</p>
            </div>
          ) : (
            notifications.map((n) => {
              const severityStyles = {
                critical: 'border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/30',
                warning: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/30',
                info: 'border-slate-300 bg-slate-100/50 dark:border-slate-800/60 dark:bg-slate-900/30',
                success: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
              };

              return (
                <div
                  key={n.id}
                  onClick={() => {
                    markNotificationRead(n.id);
                    if (n.actionView) {
                      setCurrentView(n.actionView);
                      setIsNotificationsOpen(false);
                    }
                  }}
                  className={`group relative cursor-pointer rounded-xl border p-3.5 transition-all hover:shadow-xs ${
                    severityStyles[n.severity]
                  } ${!n.read ? 'ring-1 ring-slate-800/30' : 'opacity-85'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {!n.read && <div className="h-2 w-2 rounded-full bg-slate-800 dark:bg-slate-400 shrink-0" />}
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</h4>
                    </div>
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {n.timestamp}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{n.message}</p>

                  {n.actionView && (
                    <div className="mt-2.5 flex items-center justify-end text-[11px] font-semibold text-slate-800 group-hover:underline dark:text-slate-400">
                      <span>View in {n.actionView.replace('-', ' ')}</span>
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/60">
          Syncs with purchase approvals, overdue receivables & stock triggers.
        </div>
      </div>
    </div>
  );
};
