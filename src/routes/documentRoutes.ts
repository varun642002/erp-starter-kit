import type { Express, Request, Response } from 'express';
import { actorName, getAuthContext, scopedBranch } from './context.ts';
import { autoSendBill } from '../db/billMessenger.ts';
import {
  DocumentError,
  WRITE_ROLES,
  addPayment,
  cancelDocument,
  deleteDocument,
  changeQuotationStatus,
  convertQuotation,
  createDocument,
  duplicateDocument,
  getDocument,
  getSummary,
  issueDocument,
  listDocuments,
  updateDocument
} from '../db/documentService.ts';

function fail(res: Response, label: string, e: any) {
  if (e instanceof DocumentError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Document request failed' });
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const idParam = (req: Request) => String(req.params.id);

function handle(label: string, fn: (req: Request) => Promise<unknown>, okStatus = 200) {
  return async (req: Request, res: Response) => {
    const { role } = getAuthContext(req);
    if (!WRITE_ROLES.includes(role)) {
      return res.status(403).json({ error: `The ${role} role cannot access invoices and quotations` });
    }
    try {
      res.status(okStatus).json(await fn(req));
    } catch (e) {
      fail(res, label, e);
    }
  };
}

function publicBase(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.get('host')}`;
}

// After an invoice is issued, send the bill link to the customer. Runs in the background and never fails the request.
function sendBillAfter(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    const out: any = await fn(req);
    if (out && out.docType === 'invoice' && ['Issued', 'Partially Paid', 'Paid'].includes(String(out.status))) {
      void autoSendBill(out.id, { fallbackBase: publicBase(req), user: actorName(req, undefined, 'Automatic') });
    }
    return out;
  };
}

export function registerDocumentRoutes(app: Express): void {
  app.get(
    '/api/documents/summary',
    handle('GET /api/documents/summary', (req) =>
      getSummary(scopedBranch(req), str(req.query.type), str(req.query.company_id), str(req.query.subsidy), str(req.query.from), str(req.query.to))
    )
  );

  app.get(
    '/api/documents',
    handle('GET /api/documents', (req) =>
      listDocuments(scopedBranch(req), {
        type: str(req.query.type),
        companyId: str(req.query.company_id),
        status: str(req.query.status),
        subsidy: str(req.query.subsidy),
        q: str(req.query.q),
        from: str(req.query.from),
        to: str(req.query.to)
      })
    )
  );

  app.delete(
    '/api/documents/:id',
    handle('DELETE /api/documents/:id', (req) => {
      // Deleting an issued or paid invoice is for the Super Admin only.
      const force = req.query.force === '1';
      if (force && getAuthContext(req).role !== 'Super Admin') {
        throw new DocumentError('Only the Super Admin can delete an issued or paid invoice.', 403);
      }
      return deleteDocument(idParam(req), scopedBranch(req), force);
    })
  );

  app.get(
    '/api/documents/:id',
    handle('GET /api/documents/:id', (req) => getDocument(idParam(req), scopedBranch(req)))
  );

  app.post(
    '/api/documents',
    handle(
      'POST /api/documents',
      sendBillAfter(async (req) => {
        const { isOwner, branchId, role } = getAuthContext(req);
        const body = req.body || {};
        const target = isOwner ? str(body.branchId) || str(req.query.branch_id) : branchId;
        if (!target || target === 'all') {
          throw new DocumentError('Select a specific branch to create a document');
        }
        return createDocument(body, target, role);
      }),
      201
    )
  );

  app.put(
    '/api/documents/:id',
    handle(
      'PUT /api/documents/:id',
      sendBillAfter((req) => {
        // Editing an issued or paid invoice is for the Super Admin only.
        const force = req.query.force === '1';
        if (force && getAuthContext(req).role !== 'Super Admin') {
          throw new DocumentError('Only the Super Admin can edit an issued or paid invoice.', 403);
        }
        return updateDocument(idParam(req), req.body || {}, scopedBranch(req), force);
      })
    )
  );

  // Send (or send again) the bill link to the customer's WhatsApp right now.
  app.post(
    '/api/documents/:id/send-bill',
    handle('POST /api/documents/:id/send-bill', async (req) => {
      await getDocument(idParam(req), scopedBranch(req)); // access check
      return autoSendBill(idParam(req), { force: true, fallbackBase: publicBase(req), user: actorName(req, undefined, 'Staff') });
    })
  );

  app.post(
    '/api/documents/:id/issue',
    handle('POST /api/documents/:id/issue', sendBillAfter((req) => issueDocument(idParam(req), req.body || {}, scopedBranch(req))))
  );

  app.post(
    '/api/documents/:id/payments',
    handle(
      'POST /api/documents/:id/payments',
      (req) => addPayment(idParam(req), req.body || {}, scopedBranch(req), getAuthContext(req).role),
      201
    )
  );

  app.post(
    '/api/documents/:id/convert',
    handle(
      'POST /api/documents/:id/convert',
      (req) => convertQuotation(idParam(req), scopedBranch(req), getAuthContext(req).role, req.body || {}),
      201
    )
  );

  app.post(
    '/api/documents/:id/cancel',
    handle('POST /api/documents/:id/cancel', (req) => cancelDocument(idParam(req), scopedBranch(req)))
  );

  app.post(
    '/api/documents/:id/duplicate',
    handle(
      'POST /api/documents/:id/duplicate',
      (req) => duplicateDocument(idParam(req), scopedBranch(req), getAuthContext(req).role),
      201
    )
  );

  app.post(
    '/api/documents/:id/status',
    handle('POST /api/documents/:id/status', (req) =>
      changeQuotationStatus(idParam(req), String(req.body?.status || ''), scopedBranch(req))
    )
  );
}
