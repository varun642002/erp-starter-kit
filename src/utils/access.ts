// Who may see which screens. Server routes enforce the same lists, so hiding a menu entry is never the only guard.

// Invoices and quotations: Super Admin, owner and branch manager only.
export const INVOICE_ROLES = ['Super Admin', 'Business Owner', 'Branch Manager'];
export const canUseInvoices = (role: string | undefined | null) => !!role && INVOICE_ROLES.includes(role);

// Staff attendance: Super Admin, owner and branch manager only.
export const ATTENDANCE_ROLES = ['Super Admin', 'Business Owner', 'Branch Manager'];
export const canUseAttendance = (role: string | undefined | null) => !!role && ATTENDANCE_ROLES.includes(role);

// Insights / reports: Super Admin and owner only.
export const INSIGHT_ROLES = ['Super Admin', 'Business Owner'];
export const canSeeInsights = (role: string | undefined | null) => !!role && INSIGHT_ROLES.includes(role);

// Predictions: Super Admin only (the signed-in account must be a Super Admin and be working as one).
export const canSeePredictions = (isSuperAdmin: boolean, role: string | undefined | null) => isSuperAdmin && role === 'Super Admin';

// Business Desk: the Super Admin and the Business Owner see every tab; everyone else sees only these five (Today, Cash in hand, Buy list, Customers, Warranty claims).
export const DESK_TABS_FOR_OTHERS = ['today', 'hand', 'buy', 'rank', 'claims'] as const;
export const canSeeAllDeskTabs = (isSuperAdmin: boolean, role: string | undefined | null) => (isSuperAdmin && role === 'Super Admin') || role === 'Business Owner';

// Access requests: Super Admin only (the signed-in account must be a Super Admin and be working as one).
export const canSeeAccessRequests = (isSuperAdmin: boolean, role: string | undefined | null) => isSuperAdmin && role === 'Super Admin';
