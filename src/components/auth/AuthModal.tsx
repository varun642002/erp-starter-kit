import React from 'react';
import { ShieldCheck, LogOut, CheckCircle2, Cloud, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { firebaseUser, userProfile, signOutUser } = useAuth();

  if (!isOpen) return null;

  const handleSignOut = async () => {
    await signOutUser();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/10 text-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">My Account</h3>
              <p className="text-[11px] text-slate-500">Signed in with email and password</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {firebaseUser && (
            <div className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 font-bold text-white shadow-xs">
                {(userProfile?.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {userProfile?.displayName || 'ERP User'}
                  </h4>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{firebaseUser.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-900 dark:bg-slate-800 dark:text-slate-300">
                    {userProfile?.role}
                  </span>
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-900 dark:bg-slate-800 dark:text-slate-300">
                    {userProfile?.branchId}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3.5 dark:border-emerald-950/60 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <Cloud className="h-4 w-4" />
              <span>Cloud Firestore Sync Active</span>
            </div>
            <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              Your role and branch are assigned by a Super Admin and cannot be changed from this screen.
            </p>
          </div>

          <button
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <LogOut className="h-3.5 w-3.5 text-red-500" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
