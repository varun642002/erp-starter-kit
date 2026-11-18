import { authFetch } from './authFetch';

export type VoiceIntent =
  | 'add_product'
  | 'change_quantity'
  | 'remove_product'
  | 'search_product'
  | 'show_cart'
  | 'get_total'
  | 'select_customer'
  | 'apply_discount'
  | 'clear_draft'
  | 'request_save'
  | 'confirm_save'
  | 'cancel_save'
  | 'help'
  | 'unknown';

export interface VoiceProductCandidate {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: number;
  stock: number;
  score: number;
  matchedBy: 'item_number' | 'part_number' | 'hsn' | 'name' | 'alias' | 'similar_sound';
}

export interface VoiceCustomerCandidate {
  id: string;
  name: string;
  companyName: string;
  phone: string;
  city: string;
  branchId: string | null;
  score: number;
  exact: boolean;
  record: Record<string, any>;
}

export interface VoiceCommand {
  intent: VoiceIntent;
  product_query: string | null;
  quantity: number | null;
  unit: string | null;
  discount: { type: 'percent' | 'amount'; value: number } | null;
  customer_query: string | null;
  requires_confirmation: boolean;
  product?: { status: 'matched' | 'ambiguous' | 'none'; needsConfirm?: boolean; candidates: VoiceProductCandidate[] };
  cartMatch?: { status: 'matched' | 'ambiguous' | 'none'; productIds: string[] };
  customer?: { status: 'matched' | 'ambiguous' | 'none'; candidates: VoiceCustomerCandidate[] };
}

export interface InterpretResponse {
  interpreter: 'ai' | 'rules';
  commands: VoiceCommand[];
}

export async function interpretVoice(payload: {
  text: string;
  awaiting: 'save' | 'clear' | null;
  cart: { productId: string; name: string; sku?: string }[];
  warehouseId?: string;
  branchId?: string;
}): Promise<InterpretResponse> {
  const res = await authFetch('/api/voice/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Voice request failed (${res.status})`);
  }
  return res.json();
}

export async function getVoiceStatus(): Promise<{ interpreter: 'ai' | 'rules' }> {
  const res = await authFetch('/api/voice/status');
  if (!res.ok) throw new Error('Voice status unavailable');
  return res.json();
}
