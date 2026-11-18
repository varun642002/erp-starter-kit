import React, { useState } from 'react';
import {
  Search,
  Building2,
  Warehouse as WarehouseIcon,
  Plus,
  Bell,
  Sun,
  Moon,
  UserCheck,
  ChevronDown,
  Menu,
  Shield,
  Layers,
  HelpCircle,
  LogOut,
  Sparkles,
  CloudCheck,
  LogIn,
  History,
  Wrench,
  Zap
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types/erp';
import { SyncStatusBadge } from '../auth/SyncStatusBadge';
import { AuthModal } from '../auth/AuthModal';
import { usePendingAccessCount } from '../../hooks/usePendingAccessCount';

export const Header: React.FC = () => {
  const {
    selectedBranchId,
    setSelectedBranchId,
    branches,
    currentBranchName,
    selectedWarehouseId,
    setSelectedWarehouseId,
    warehouses,
    currentRole,
    setCurrentRole,
    currentUser,
    notifications,
    setIsNotificationsOpen,
    setIsGlobalSearchOpen,
    openQuickAdd,
    theme,
    toggleTheme,
    toggleSidebar,
    setCurrentView,
    canEditStock
  } = useERP();

  const { firebaseUser, userProfile, isSuperAdmin, signOutUser } = useAuth();
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const unreadNotifCount = notifications.filter(n => !n.read).length;
  const pendingAccessCount = usePendingAccessCount();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';

  const rolesList: Role[] = [
    'Business Owner',
    'Branch Person',
    'Branch Manager',
    'Accountant',
    'Super Admin'
  ];

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between gap-2 border-b border-white/60 bg-white/60 px-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.7),0_8px_30px_-14px_rgba(30,41,90,0.2)] backdrop-blur-2xl backdrop-saturate-150 sm:h-16 sm:px-6 [@media(max-height:500px)]:h-12 dark:border-white/10 dark:bg-slate-900/60">
        {/* Left section: Hamburger for mobile + Global Search trigger */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 2xl:flex-none">
          <button
            onClick={toggleSidebar}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Toggle Navigation"
          >
            <Menu className="h-4 w-4" />
          </button>

          {/* Global Search Button (Cmd+K) */}
          <button
            onClick={() => setIsGlobalSearchOpen(true)}
            className="group flex h-9 min-w-0 max-w-[18rem] flex-1 items-center justify-between rounded-md bg-slate-100 px-3 text-xs text-slate-500 2xl:w-72 2xl:flex-none transition-all hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700/80"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200" />
              <span className="truncate whitespace-nowrap font-medium">Search records</span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <span className="text-[10px]">⌘</span>K
            </kbd>
          </button>
        </div>

        {/* Right section: Selectors, Quick Action, Role switcher, Notifications, Profile */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Firestore Sync Badge */}
          <div className="hidden min-[1800px]:block"><SyncStatusBadge /></div>

          {/* Branch Selector (Dropdown for Business Owner, Fixed Badge for Branch Person) */}
          {isOwner ? (
            <div className="relative hidden 2xl:flex items-center">
              <div className="pointer-events-none absolute left-2.5 flex items-center text-slate-400">
                <span className="text-slate-400 text-[10px] font-semibold uppercase">Branch:</span>
              </div>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                aria-label="Select Branch"
                className="h-9 cursor-pointer appearance-none rounded-md border border-slate-200 bg-white py-1.5 pl-16 pr-7 text-xs font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">All 6 Branches (Company-Wide)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
            </div>
          ) : (
            <div className="hidden 2xl:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-semibold">
              <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Branch: {currentBranchName}</span>
              <span className="text-[10px] font-normal text-blue-500 dark:text-blue-400">(Assigned)</span>
            </div>
          )}

          {/* Quick Sale: straight to the counter sale screen */}
          <button
            onClick={() => setCurrentView('quick-sale')}
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-2.5 text-xs sm:px-3.5 font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-98"
            title="Open Quick Sale"
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quick Sale</span>
          </button>

          {/* Quick Add Button */}
          <button
            onClick={() => openQuickAdd('sale')}
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-2.5 text-xs sm:px-3.5 font-semibold text-white shadow-xs transition-all hover:bg-blue-700 active:scale-98"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quick Add</span>
          </button>

          {/* Role Persona Switcher (Super Admin only); everyone else sees their assigned role */}
          {!isSuperAdmin && (
            <div className="hidden h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-900 2xl:flex dark:border-slate-700 dark:bg-slate-900 dark:text-white">
              <Shield className="h-3.5 w-3.5 text-amber-500" />
              <span className="whitespace-nowrap">{userProfile?.role || currentRole}</span>
            </div>
          )}
          {isSuperAdmin && (
          <div className="relative">
            <button
              onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              title="Switch Dashboard Role View"
            >
              <Shield className="h-3.5 w-3.5 text-amber-500" />
              <span className="hidden whitespace-nowrap font-semibold text-slate-900 lg:inline dark:text-white">{currentRole}</span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {isRoleDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-54 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900 z-50 animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Persona Perspective
                </div>
                {rolesList.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setCurrentRole(r);
                      setIsRoleDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                      currentRole === r
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{r}</span>
                    {currentRole === r && <Sparkles className="h-3 w-3 text-blue-600 dark:text-blue-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Pending access requests (Super Admin only) */}
          {isSuperAdmin && currentRole === 'Super Admin' && pendingAccessCount > 0 && (
            <button
              onClick={() => setCurrentView('access-requests')}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
              title="Review people waiting for access"
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{pendingAccessCount} access request{pendingAccessCount > 1 ? 's' : ''}</span>
              <span className="md:hidden">{pendingAccessCount}</span>
            </button>
          )}

          {/* Notifications Icon Button */}
          <button
            onClick={() => setIsNotificationsOpen(true)}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Notification Center"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-red-500 border border-white dark:border-slate-900 shadow-xs" />
            )}
          </button>

          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border 2xl:flex border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? <Moon className="h-4 w-4 text-slate-600" /> : <Sun className="h-4 w-4 text-amber-400" />}
          </button>

          {/* User Profile / Firebase Auth Button */}
          {firebaseUser ? (
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                title={firebaseUser.email || 'Firebase Account'}
              >
                {firebaseUser.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={firebaseUser.displayName || 'Avatar'}
                    referrerPolicy="no-referrer"
                    className="h-8 w-8 rounded-full border border-slate-200 object-cover shadow-xs dark:border-slate-700"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 font-bold text-white text-xs shadow-xs">
                    {(firebaseUser.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
                  </div>
                )}
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900 z-50 animate-in fade-in zoom-in-95">
                  <div className="flex items-center gap-2.5 border-b border-slate-100 px-2.5 pb-2.5 pt-1 dark:border-slate-800">
                    {firebaseUser.photoURL ? (
                      <img
                        src={firebaseUser.photoURL}
                        alt="Avatar"
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 font-bold text-white text-xs">
                        {(firebaseUser.displayName || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                        {currentRole === 'Branch Person' || currentRole === 'Branch Manager' ? currentBranchName : firebaseUser.displayName || 'Google User'}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {firebaseUser.email}
                      </p>
                      <span className="mt-0.5 inline-block rounded bg-emerald-50 px-1.5 py-0.2 font-mono text-[9px] font-medium text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                        Google Auth Verified
                      </span>
                    </div>
                  </div>
                  <div className="pt-1.5 space-y-0.5">
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setCurrentView('activity-logs');
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <History className="h-3.5 w-3.5 text-indigo-500" />
                        Audit Trail & Logs
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">View</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setIsAuthModalOpen(true);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span>Manage Cloud & Role</span>
                      <Shield className="h-3.5 w-3.5 text-blue-500" />
                    </button>
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        signOutUser();
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                    >
                      <span>Sign Out</span>
                      <LogOut className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-3 text-xs font-bold text-blue-700 transition-all hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Second row below very wide screens: branch, role and theme, so nothing is pushed off the screen */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 sm:px-6 2xl:hidden dark:border-slate-800 dark:bg-slate-900">
        {isOwner ? (
          <div className="relative flex min-w-0 max-w-sm flex-1 items-center">
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              aria-label="Select Branch"
              className="h-8 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-slate-200 bg-white py-1 pl-3 pr-7 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="all">All {branches.length} branches (company-wide)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="truncate">Branch: {currentBranchName}</span>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
        {!isSuperAdmin && (
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
            <Shield className="h-3 w-3 text-amber-500" />
            {userProfile?.role || currentRole}
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          aria-label="Switch theme"
        >
          {theme === 'light' ? <Moon className="h-4 w-4 text-slate-600" /> : <Sun className="h-4 w-4 text-amber-400" />}
        </button>
        </div>
      </div>

      {/* Google Auth & Firestore Profile Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </>
  );
};

