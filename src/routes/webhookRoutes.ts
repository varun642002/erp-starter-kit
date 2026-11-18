import type { Express, Request, Response } from 'express';
import { handleInbound, validSignature, webhookSetup } from '../db/optOuts.ts';

// Meta calls these from outside, so they sit outside /api and have no sign-in. They are protected by Meta's own checks instead:
// the verify token when the webhook is first connected, and the signature on every message after that.
export function registerWebhookRoutes(app: Express): void {
  // Connecting the webhook: Meta sends hub.mode, hub.verify_token and hub.challenge and expects the challenge back.
  app.get('/webhooks/whatsapp', (req: Request, res: Response) => {
    const { verifyToken } = webhookSetup();
    if (verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
      return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
    }
    res.sendStatus(403);
  });

  // Replies from customers. Anything not signed by Meta is ignored, so nobody can opt a customer out by faking a message.
  app.post('/webhooks/whatsapp', async (req: Request, res: Response) => {
    const { appSecret } = webhookSetup();
    if (!appSecret) return res.sendStatus(503);
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!validSignature(raw, req.header('x-hub-signature-256'), appSecret)) return res.sendStatus(401);
    try {
      await handleInbound(req.body);
    } catch (e: any) {
      console.error('WhatsApp webhook notice:', e?.message || e);
      return res.sendStatus(500); // Meta tries the same reply again later; saving a STOP twice does no harm
    }
    res.sendStatus(200);
  });
}
