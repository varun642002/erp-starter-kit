import type { Express, Request, Response } from 'express';
import { getAuthContext } from './context.ts';
import {
  VoiceError,
  aiConfigured,
  assertWarehouseAccess,
  interpret,
  listAliases,
  replaceAliases,
  type Awaiting,
  type CartRef
} from '../db/voiceService.ts';
import { branchPersonCanEditStock } from '../db/appSettings.ts';
import { canEditProducts, type Actor } from '../db/stockService.ts';

function fail(res: Response, label: string, e: any) {
  if (e instanceof VoiceError) return res.status(e.status).json({ error: e.message });
  console.error(`API ${label} error:`, e);
  return res.status(500).json({ error: e?.message || 'Voice request failed' });
}

function actorOf(req: Request): Actor {
  const { role, branchId, isOwner } = getAuthContext(req);
  return { role, branchId, isOwner, name: req.auth?.email || role };
}

export function registerVoiceRoutes(app: Express): void {
  // Which interpreter is active, so the screen can say so.
  app.get('/api/voice/status', (_req, res) => {
    res.json({ interpreter: aiConfigured() ? 'ai' : 'rules' });
  });

  // One spoken sentence -> structured commands, with products / customers looked up in the real database.
  // Only the sentence and the names of items already in the sale are used; no customer or sale record is sent anywhere.
  app.post('/api/voice/interpret', async (req, res) => {
    try {
      const { isOwner, branchId } = getAuthContext(req);
      const body = req.body || {};
      if (typeof body.text !== 'string' || !body.text.trim()) throw new VoiceError('text is required');

      const awaiting: Awaiting = body.awaiting === 'save' || body.awaiting === 'clear' ? body.awaiting : null;
      const cart: CartRef[] = (Array.isArray(body.cart) ? body.cart : [])
        .slice(0, 100)
        .filter((c: any) => c && typeof c.productId === 'string' && typeof c.name === 'string')
        .map((c: any) => ({ productId: c.productId, name: c.name.slice(0, 200), sku: typeof c.sku === 'string' ? c.sku : undefined }));
      const warehouseId = typeof body.warehouseId === 'string' ? body.warehouseId : undefined;
      await assertWarehouseAccess(warehouseId, isOwner, branchId);

      // Customers are searched inside the signed-in user's own branch; owners may search every branch.
      const customerBranchId = isOwner ? (typeof body.branchId === 'string' && body.branchId !== 'all' ? body.branchId : null) : branchId;

      res.json(
        await interpret({ text: body.text, awaiting, cart, warehouseId, customerBranchId })
      );
    } catch (e) {
      fail(res, 'POST /api/voice/interpret', e);
    }
  });

  app.get('/api/products/:id/aliases', async (req, res) => {
    try {
      res.json({ aliases: await listAliases(String(req.params.id)) });
    } catch (e) {
      fail(res, 'GET /api/products/:id/aliases', e);
    }
  });

  app.put('/api/products/:id/aliases', async (req, res) => {
    try {
      const actor = actorOf(req);
      if (!canEditProducts(actor) && !(actor.role === 'Branch Person' && (await branchPersonCanEditStock()))) {
        return res.status(403).json({ error: 'Access Denied: only owners and the Warehouse Manager can edit voice names.' });
      }
      res.json({ aliases: await replaceAliases(String(req.params.id), req.body?.aliases) });
    } catch (e) {
      fail(res, 'PUT /api/products/:id/aliases', e);
    }
  });
}
