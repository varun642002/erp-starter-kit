import React from 'react';
import { Cloud, CloudCheck, CloudOff, RefreshCw, Database } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';

export const SyncStatusBadge: React.FC = () => {
  const { syncStatus, syncNowToFirestore, isFirestoreConnected } = useERP();
  const { firebaseUser, userProfile } = useAuth();

  return (
    <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300">
      {syncStatus === 'synced' ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">Firestore Connected</span>
        </>
      ) : syncStatus === 'syncing' ? (
        <>
          <RefreshCw className="h-3 w-3 animate-spin text-slate-800" />
          <span className="text-slate-800 dark:text-slate-400">Syncing Cloud...</span>
        </>
      ) : (
        <>
          <Database className="h-3 w-3 text-amber-500" />
          <span className="text-amber-600 dark:text-amber-400">Local Cache</span>
        </>
      )}

      <button
        onClick={() => syncNowToFirestore()}
        title="Force Refresh & Sync with Cloud Firestore"
        className="ml-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
      >
        <RefreshCw className="h-2.5 w-2.5 hover:rotate-180 transition-transform duration-300" />
      </button>
    </div>
  );
};
