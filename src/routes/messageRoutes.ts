import type { Express, Request, Response } from 'express';
import { getMessageQueue, listMessages, logMessage, marketingSent, MESSAGE_KINDS, type MessageKind } from '../db/messageService.ts';
import { actorName, getAuthContext, scopedBranch } from './context.ts';
import { autoSendStatus } from '../db/billMessenger.ts';
import { MAX_GROUP, marketingStatus, sendMarketingGroup } from '../db/marketingSender.ts';
import { reminderStatus, sendPaymentReminders } from '../db/reminderSender.ts';
import { payLinkStatus, payUrl } from '../db/payLink.ts';
import { optedOutNumbers } from '../db/optOuts.ts';
import { broadcastStatus, cancelBroadcast, createBroadcast, getBroadcast, listBroadcasts, processBroadcast } from '../db/broadcastQueue.ts';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function registerMessageRoutes(app: Express): void {
  app.get('/api/messages/auto-status', (_req: Request, res: Response) => {
    res.json(autoSendStatus());
  });

  app.get('/api/messages/queue', async (req: Request, res: Response) => {
    try {
      const q = await getMessageQueue(scopedBranch(req));
      // each pending payment carries its own Pay now link (empty when the link is not set up)
      res.json({ ...q, overdueInvoices: q.overdueInvoices.map((i) => ({ ...i, payUrl: payUrl(i.source, i.invoiceId) })) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Is automatic sending of payment reminders set up?
  app.get('/api/messages/reminder-status', async (_req: Request, res: Response) => {
    res.json({ ...reminderStatus(), payLink: await payLinkStatus() });
  });

  // Sends the approved payment-reminder template to the chosen people (what is owed is read again on the server).
  app.post('/api/messages/payment-reminders-send', async (req: Request, res: Response) => {
    try {
      const { role, isOwner } = getAuthContext(req);
      const b = req.body || {};
      const items = Array.isArray(b.items)
        ? b.items
            .map((i: any) => ({ source: text(i?.source), refId: text(i?.refId) }))
            .filter((i: any) => ['invoice', 'machine-sale', 'job-card'].includes(i.source) && i.refId)
        : [];
      // a branch user can only remind the customers of his own branch; the owner may send across branches
      const result = await sendPaymentReminders(
        { items, branchId: scopedBranch(req), force: isOwner && b.force === true, testTo: isOwner ? text(b.testTo) || undefined : undefined },
        actorName(req, text(b.sentBy), role)
      );
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not send the reminders.' });
    }
  });

  // Is one-tap sending to a whole group set up? (owners only)
  app.get('/api/messages/marketing-status', (req: Request, res: Response) => {
    if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Bulk marketing is for the owner and Super Admin.' });
    res.json({ ...marketingStatus(), maxGroup: MAX_GROUP });
  });

  // Sends the approved marketing template to a whole group at once (owners only, up to 200 people).
  app.post('/api/messages/marketing-send', async (req: Request, res: Response) => {
    try {
      const { role, isOwner } = getAuthContext(req);
      if (!isOwner) return res.status(403).json({ error: 'Bulk marketing is for the owner and Super Admin.' });
      const b = req.body || {};
      const recipients = Array.isArray(b.recipients)
        ? b.recipients.map((r: any) => ({
            customerId: text(r?.customerId) || null,
            name: text(r?.name),
            phone: text(r?.phone),
            branchId: text(r?.branchId) || null
          }))
        : [];
      const result = await sendMarketingGroup(
        {
          campaign: text(b.campaign),
          offerText: text(b.offerText),
          recipients,
          poster: b.poster && typeof b.poster.data === 'string' ? { mime: text(b.poster.mime), data: b.poster.data } : undefined
        },
        actorName(req, text(b.sentBy), role)
      );
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not send the group.' });
    }
  });

  // A greeting (picture + short message) to every customer with a mobile number, queued and sent in batches (owners only).
  const ownerOnly = (req: Request, res: Response): boolean => {
    if (getAuthContext(req).isOwner) return true;
    res.status(403).json({ error: 'Group greetings are for the owner and Super Admin.' });
    return false;
  };

  app.get('/api/messages/broadcast-status', async (req: Request, res: Response) => {
    try {
      if (!ownerOnly(req, res)) return;
      res.json({ ...broadcastStatus(), recent: await listBroadcasts(8), optedOut: (await optedOutNumbers()).size });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/messages/broadcast', async (req: Request, res: Response) => {
    try {
      if (!ownerOnly(req, res)) return;
      const { role } = getAuthContext(req);
      const b = req.body || {};
      const recipients = Array.isArray(b.recipients)
        ? b.recipients.map((r: any) => ({ customerId: text(r?.customerId) || null, name: text(r?.name), phone: text(r?.phone), branchId: text(r?.branchId) || null }))
        : [];
      const job = await createBroadcast(
        { title: text(b.title), message: text(b.message), poster: { mime: text(b.poster?.mime), data: typeof b.poster?.data === 'string' ? b.poster.data : '' }, recipients },
        actorName(req, text(b.sentBy), role)
      );
      res.status(201).json(job);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not start the group greeting.' });
    }
  });

  // Sends the next batch (about 20 seconds of work) and returns the progress. The open page calls this until it is done.
  app.post('/api/messages/broadcast/:id/tick', async (req: Request, res: Response) => {
    try {
      if (!ownerOnly(req, res)) return;
      await processBroadcast(req.params.id, 18_000);
      const out = await getBroadcast(req.params.id);
      if (!out) return res.status(404).json({ error: 'Greeting not found.' });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not send the next batch.' });
    }
  });

  app.get('/api/messages/broadcast/:id', async (req: Request, res: Response) => {
    try {
      if (!ownerOnly(req, res)) return;
      const out = await getBroadcast(req.params.id);
      if (!out) return res.status(404).json({ error: 'Greeting not found.' });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/messages/broadcast/:id/cancel', async (req: Request, res: Response) => {
    try {
      if (!ownerOnly(req, res)) return;
      await cancelBroadcast(req.params.id);
      const out = await getBroadcast(req.params.id);
      if (!out) return res.status(404).json({ error: 'Greeting not found.' });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Progress of a bulk marketing campaign (owners only).
  app.get('/api/messages/marketing-sent', async (req: Request, res: Response) => {
    try {
      if (!getAuthContext(req).isOwner) return res.status(403).json({ error: 'Bulk marketing is for the owner and Super Admin.' });
      const campaign = text(req.query.campaign).slice(0, 120);
      if (!campaign) return res.status(400).json({ error: 'campaign is required.' });
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '0'), 10) || 0, 0), 365);
      res.json(await marketingSent(campaign, days));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/messages/log', async (req: Request, res: Response) => {
    try {
      const kind = text(req.query.kind);
      if (kind && !MESSAGE_KINDS.includes(kind as MessageKind)) {
        return res.status(400).json({ error: 'Invalid message kind.' });
      }
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
      res.json(await listMessages(scopedBranch(req), limit, kind || undefined));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/messages/log', async (req: Request, res: Response) => {
    try {
      const { role, branchId: headerBranch, isOwner } = getAuthContext(req);
      const b = req.body || {};

      const kind = text(b.kind);
      if (!MESSAGE_KINDS.includes(kind as MessageKind)) {
        return res.status(400).json({ error: 'Invalid message kind.' });
      }
      if (kind === 'marketing' && !isOwner) {
        return res.status(403).json({ error: 'Bulk marketing is for the owner and Super Admin.' });
      }
      const customerName = text(b.customerName);
      const phone = text(b.phone);
      const body = text(b.body);
      if (!customerName) return res.status(400).json({ error: 'customerName is required.' });
      if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'A valid phone number is required.' });
      if (!body) return res.status(400).json({ error: 'Message body is required.' });
      const language = b.language === 'ta' ? 'ta' : 'en';

      // Only owners may log against a branch other than their own (queue rows can span branches).
      const requestedBranch = text(b.branchId);
      const branchId = isOwner && requestedBranch && requestedBranch !== 'all' ? requestedBranch : headerBranch;
      const sentBy = actorName(req, text(b.sentBy), role);

      const saved = await logMessage({
        branchId,
        kind: kind as MessageKind,
        refType: text(b.refType) || null,
        refId: text(b.refId) || null,
        customerId: text(b.customerId) || null,
        customerName,
        phone,
        language,
        body,
        sentBy
      });
      res.status(201).json(saved);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
