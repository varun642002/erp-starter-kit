import { apiRequest, type ApiScope } from './apiClient';
import type { BroadcastJob, BroadcastFailure, BroadcastStatus } from '../db/broadcastQueue';
export type { BroadcastJob, BroadcastFailure, BroadcastStatus };

export type MessageKind = 'payment-reminder' | 'warranty-expiry' | 'job-ready' | 'invoice' | 'custom' | 'marketing' | 'thank-you';

interface QueueBase {
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  alternatePhone: string | null;
  lastMessagedAt: string | null;
}

export type PendingSource = 'invoice' | 'machine-sale' | 'job-card';

// Everyone with a pending payment (not only overdue ones): invoices, machine sales and job cards.
export interface OverdueInvoiceItem extends QueueBase {
  source?: PendingSource;
  invoiceId: string; // id of the invoice, machine sale or job card
  invoiceNumber: string;
  balance: number;
  dueDate: string | null;
  billDate?: string | null;
  daysOverdue: number;
  payUrl?: string | null; // the Pay now link of this bill (null when it is not set up)
}

export interface WarrantyExpiringItem extends QueueBase {
  warrantyId: string;
  serialNumber: string;
  productName: string;
  expiryDate: string;
  daysLeft: number;
}

export interface JobReadyItem extends QueueBase {
  jobCardId: string;
  jobNumber: string;
  machineModel: string | null;
  balanceDue: number;
}

export interface MessageQueue {
  overdueInvoices: OverdueInvoiceItem[];
  warrantyExpiring: WarrantyExpiringItem[];
  jobsReady: JobReadyItem[];
}

export interface MessageLogEntry {
  id: string;
  branchId: string;
  kind: MessageKind;
  refType: string | null;
  refId: string | null;
  customerId: string | null;
  customerName: string;
  phone: string;
  channel: string;
  language: 'en' | 'ta';
  body: string;
  sentBy: string | null;
  createdAt: string;
}

export interface MessageLogInput {
  kind: MessageKind;
  refType?: string;
  refId?: string;
  customerId?: string | null;
  customerName: string;
  phone: string;
  language: 'en' | 'ta';
  body: string;
  branchId?: string | null;
  sentBy?: string;
}

export interface AutoSendStatus {
  configured: boolean;
  missing: string[];
  templateName: string;
  templateLanguage: string;
  publicBaseUrl: string | null;
}

export const fetchAutoSendStatus = (scope: ApiScope) => apiRequest<AutoSendStatus>('/messages/auto-status', scope);

export const fetchMessageQueue = (scope: ApiScope, branchId?: string) =>
  apiRequest<MessageQueue>('/messages/queue', scope, { query: { branch_id: branchId } });

export const fetchMessageLog = (scope: ApiScope, opts: { branchId?: string; kind?: string; limit?: number } = {}) =>
  apiRequest<MessageLogEntry[]>('/messages/log', scope, {
    query: { branch_id: opts.branchId, kind: opts.kind, limit: opts.limit ?? 100 }
  });

export const postMessageLog = (scope: ApiScope, input: MessageLogInput, branchId?: string) =>
  apiRequest<MessageLogEntry>('/messages/log', scope, {
    method: 'POST',
    query: { branch_id: branchId },
    body: input
  });

export interface MarketingProgress {
  done: string[]; // numbers already opened in this campaign
  recent: string[]; // numbers sent a marketing message in another campaign recently
}

export interface MarketingStatus {
  configured: boolean;
  missing: string[];
  templateName: string | null;
  templateLanguage: string;
  posterMode?: boolean;
  maxGroup: number;
}

export interface MarketingSendResult {
  sent: number;
  failed: number;
  skipped: number;
  stoppedEarly: string | null;
  failures: { name: string; phone: string; error: string }[];
}

export interface ReminderStatus {
  configured: boolean;
  missing: string[];
  templateName: string;
  templateLanguage: string;
  usesLink: boolean;
  cooldownDays: number;
  maxAtOnce: number;
  payLink?: { ready: boolean; missing: string[] };
}

export interface ReminderSendResult {
  sent: number;
  failed: number;
  skipped: number;
  stoppedEarly: string | null;
  failures: { name: string; phone: string; error: string }[];
  skippedWhy: { noNumber: number; recent: number; notOwing: number };
}

export const fetchReminderStatus = (scope: ApiScope) => apiRequest<ReminderStatus>('/messages/reminder-status', scope);

export const sendPaymentReminders = (scope: ApiScope, input: { items: { source: PendingSource; refId: string }[]; sentBy?: string; force?: boolean; testTo?: string }) =>
  apiRequest<ReminderSendResult>('/messages/payment-reminders-send', scope, { method: 'POST', body: input });

export const fetchMarketingStatus = (scope: ApiScope) => apiRequest<MarketingStatus>('/messages/marketing-status', scope);

export const sendMarketingGroup = (
  scope: ApiScope,
  input: {
    campaign: string;
    offerText: string;
    sentBy?: string;
    poster?: { mime: string; data: string };
    recipients: { customerId: string; name: string; phone: string; branchId: string }[];
  }
) => apiRequest<MarketingSendResult>('/messages/marketing-send', scope, { method: 'POST', body: input });

export const fetchMarketingProgress = (scope: ApiScope, campaign: string, skipDays: number) =>
  apiRequest<MarketingProgress>('/messages/marketing-sent', scope, { query: { campaign, days: skipDays } });

// ---- Group greeting (a picture and a short message to every customer with a mobile number, queued on the server)

export const fetchBroadcastStatus = (scope: ApiScope) => apiRequest<BroadcastStatus & { recent: BroadcastJob[]; optedOut?: number }>('/messages/broadcast-status', scope);

export const startBroadcast = (
  scope: ApiScope,
  input: { title: string; message: string; poster: { mime: string; data: string }; sentBy?: string; recipients: { customerId: string; name: string; phone: string; branchId?: string | null }[] }
) => apiRequest<BroadcastJob>('/messages/broadcast', scope, { method: 'POST', body: input });

export const tickBroadcast = (scope: ApiScope, id: string) => apiRequest<{ job: BroadcastJob; failures: BroadcastFailure[] }>(`/messages/broadcast/${encodeURIComponent(id)}/tick`, scope, { method: 'POST', body: {} });

export const fetchBroadcast = (scope: ApiScope, id: string) => apiRequest<{ job: BroadcastJob; failures: BroadcastFailure[] }>(`/messages/broadcast/${encodeURIComponent(id)}`, scope);

export const cancelBroadcastJob = (scope: ApiScope, id: string) => apiRequest<{ job: BroadcastJob; failures: BroadcastFailure[] }>(`/messages/broadcast/${encodeURIComponent(id)}/cancel`, scope, { method: 'POST', body: {} });
