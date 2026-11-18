import { sql } from 'drizzle-orm';
import { db } from './index.ts';

// The services the shop does for the machines it sells (rotavator, baler, power tiller ...): a type of service and its cost.
// Kept as a small price list of its own; it is not stock, so it never touches products or warehouses.

export interface ServiceItem {
  id: string;
  name: string; // the type of service, e.g. "Gearbox overhaul"
  machineType: string | null; // the machine it is for, e.g. "Rotavator"; empty means any machine
  cost: number;
  notes: string | null;
  active: boolean;
  createdBy: string | null;
  updatedAt: string;
}

export class ServiceCatalogError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function ensureServiceCatalogTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists service_catalog (
      id text primary key,
      name text not null,
      machine_type text,
      cost double precision not null default 0,
      notes text,
      active boolean not null default true,
      created_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
}

let ready: Promise<void> | null = null;
const ensure = () => (ready ??= ensureServiceCatalogTable().catch((e) => {
  ready = null;
  throw e;
}));

const toItem = (r: any): ServiceItem => ({
  id: r.id,
  name: r.name,
  machineType: r.machine_type || null,
  cost: Number(r.cost) || 0,
  notes: r.notes || null,
  active: !!r.active,
  createdBy: r.created_by || null,
  updatedAt: new Date(r.updated_at).toISOString()
});

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function readFields(body: any, partial: boolean) {
  const out: { name?: string; machineType?: string | null; cost?: number; notes?: string | null; active?: boolean } = {};
  if (!partial || body.name !== undefined) {
    const name = clean(body.name, 120);
    if (!name) throw new ServiceCatalogError('Enter the type of service.');
    out.name = name;
  }
  if (!partial || body.machineType !== undefined) out.machineType = clean(body.machineType, 80) || null;
  if (!partial || body.cost !== undefined) {
    const cost = Number(body.cost);
    if (!Number.isFinite(cost) || cost < 0) throw new ServiceCatalogError('The cost must be a number, zero or more.');
    out.cost = Math.round(cost * 100) / 100;
  }
  if (!partial || body.notes !== undefined) out.notes = clean(body.notes, 500) || null;
  if (body.active !== undefined) out.active = body.active === true;
  return out;
}

async function assertNotDuplicate(name: string, machineType: string | null, exceptId?: string) {
  const res = await db.execute(sql`
    select id from service_catalog
    where lower(name) = ${name.toLowerCase()} and lower(coalesce(machine_type, '')) = ${(machineType || '').toLowerCase()}
      and id <> ${exceptId || ''}
    limit 1`);
  if (res.rows.length) throw new ServiceCatalogError(`"${name}"${machineType ? ` for ${machineType}` : ''} is already in the list.`, 409);
}

export async function listServices(): Promise<ServiceItem[]> {
  await ensure();
  const res = await db.execute(sql`select * from service_catalog order by lower(coalesce(machine_type, '')), lower(name)`);
  return res.rows.map(toItem);
}

export async function getService(id: string): Promise<ServiceItem | null> {
  await ensure();
  const res = await db.execute(sql`select * from service_catalog where id = ${id}`);
  return res.rows.length ? toItem(res.rows[0]) : null;
}

export async function createService(body: any, user: string): Promise<ServiceItem> {
  await ensure();
  const f = readFields(body || {}, false);
  await assertNotDuplicate(f.name!, f.machineType ?? null);
  const id = `svc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const res = await db.execute(sql`
    insert into service_catalog (id, name, machine_type, cost, notes, active, created_by)
    values (${id}, ${f.name}, ${f.machineType ?? null}, ${f.cost}, ${f.notes ?? null}, ${f.active !== false}, ${user})
    returning *`);
  return toItem(res.rows[0]);
}

export async function updateService(id: string, body: any): Promise<ServiceItem> {
  await ensure();
  const cur = await db.execute(sql`select * from service_catalog where id = ${id}`);
  if (!cur.rows.length) throw new ServiceCatalogError('That service was not found.', 404);
  const f = readFields(body || {}, true);
  const row = cur.rows[0] as any;
  const name = f.name ?? row.name;
  const machineType = f.machineType !== undefined ? f.machineType : row.machine_type || null;
  if (f.name !== undefined || f.machineType !== undefined) await assertNotDuplicate(name, machineType, id);
  const res = await db.execute(sql`
    update service_catalog set
      name = ${name},
      machine_type = ${machineType},
      cost = ${f.cost ?? row.cost},
      notes = ${f.notes !== undefined ? f.notes : row.notes},
      active = ${f.active ?? row.active},
      updated_at = now()
    where id = ${id}
    returning *`);
  return toItem(res.rows[0]);
}

export async function deleteService(id: string): Promise<void> {
  await ensure();
  const res = await db.execute(sql`delete from service_catalog where id = ${id} returning id`);
  if (!res.rows.length) throw new ServiceCatalogError('That service was not found.', 404);
}
