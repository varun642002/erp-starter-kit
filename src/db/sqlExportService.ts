import { pool } from './index.ts';

// Complete database backup behind "Download a full SQL backup" (owner only) and `npm run backup`.
//
// Every table in the public schema is included. The structure (columns, defaults, sequences, indexes, foreign keys) is read from the
// live database, so a table or column added later is backed up without touching this file. Rows are written as
// INSERT ... SELECT FROM jsonb_populate_recordset(...), which keeps every column type exact (numbers, dates, arrays, json).
//
// Everything is read inside ONE read-only snapshot, so the file is consistent even while the shop is saving bills, and nothing can
// be written. Rows are fetched a few at a time and written out as they come, so a big table does not fill the server's memory.
//
// Restore into a NEW empty PostgreSQL database:  psql -d newdb -f the-file.sql
// (It uses plain CREATE TABLE, so pointing it at a database that already has these tables fails instead of wiping them.)

const ident = (s: string) => '"' + String(s).replace(/"/g, '""') + '"';
const lit = (s: string) => "'" + String(s).replace(/'/g, "''") + "'";
const FETCH_ROWS = 100;

export interface SqlDumpSummary {
  tables: number;
  rows: number;
}

type Write = (chunk: string) => void | Promise<void>;

export async function dumpSqlTo(write: Write): Promise<{ summary: SqlDumpSummary; counts: Record<string, number> }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const q = async (text: string, params?: unknown[]) => (await client.query(text, params)).rows;

    const tables = (await q(
      `select c.relname as name, c.oid
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition and c.relname not like '\\_\\_drizzle%'
        order by c.relname`
    )) as { name: string; oid: number }[];

    await write(
      [
        `-- =====================================================================`,
        `-- ACME TRACTORS ERP: complete database backup`,
        `-- Generated: ${new Date().toISOString()}   Tables: ${tables.length}`,
        `-- Restore into a NEW empty PostgreSQL 14+ database:  psql -d newdb -f this-file.sql`,
        `-- =====================================================================`,
        `SET statement_timeout = 0; SET lock_timeout = 0; SET client_encoding = 'UTF8'; SET standard_conforming_strings = on; SET row_security = off;`,
        ''
      ].join('\n') + '\n'
    );

    const seqs = await q(
      `select sequencename, last_value, start_value, increment_by, min_value, max_value from pg_sequences where schemaname = 'public' order by sequencename`
    );
    for (const s of seqs) {
      await write(`CREATE SEQUENCE IF NOT EXISTS ${ident(s.sequencename)} START ${s.start_value} INCREMENT ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value};\n`);
    }
    await write('\n');

    const counts: Record<string, number> = {};
    let totalRows = 0;
    for (const t of tables) {
      const cols = (await q(
        `select a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as def, a.attgenerated
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`,
        [t.oid]
      )) as { attname: string; type: string; attnotnull: boolean; def: string | null; attgenerated: string }[];

      await write(
        `CREATE TABLE ${ident(t.name)} (\n` +
          cols
            .map(
              (c) =>
                `  ${ident(c.attname)} ${c.type}${c.def ? (c.attgenerated ? ` GENERATED ALWAYS AS (${c.def}) STORED` : ` DEFAULT ${c.def}`) : ''}${c.attnotnull ? ' NOT NULL' : ''}`
            )
            .join(',\n') +
          '\n);\n'
      );

      const writable = cols.filter((c) => !c.attgenerated).map((c) => ident(c.attname)).join(', ');
      let n = 0;
      await client.query(`DECLARE dump_cursor NO SCROLL CURSOR FOR select to_jsonb(t) as j from ${ident(t.name)} t`);
      for (;;) {
        const batch = (await client.query(`FETCH ${FETCH_ROWS} FROM dump_cursor`)).rows.map((r) => r.j);
        if (batch.length === 0) break;
        n += batch.length;
        await write(
          `INSERT INTO ${ident(t.name)} (${writable}) SELECT ${writable} FROM jsonb_populate_recordset(NULL::${ident(t.name)}, ${lit(JSON.stringify(batch))}::jsonb);\n`
        );
      }
      await client.query('CLOSE dump_cursor');
      counts[t.name] = n;
      totalRows += n;
      await write('\n');
    }

    for (const s of seqs) {
      if (s.last_value !== null) await write(`SELECT setval(${lit(ident(s.sequencename))}, ${s.last_value}, true);\n`);
    }
    await write('\n');

    // Primary keys and unique constraints come back as unique indexes here.
    const idx = await q(`select indexdef from pg_indexes where schemaname = 'public' and tablename not like '\\_\\_drizzle%' order by tablename, indexname`);
    for (const i of idx) await write(String(i.indexdef).replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ') + ';\n');
    await write('\n');

    // Foreign keys go last, so the order tables were loaded in does not matter.
    const fks = await q(
      `select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
         from pg_constraint c join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public' and c.contype = 'f' and c.conrelid::regclass::text not like '%\\_\\_drizzle%' order by 1, 2`
    );
    for (const f of fks) await write(`ALTER TABLE ${f.tbl} ADD CONSTRAINT ${ident(f.conname)} ${f.def};\n`);

    await client.query('COMMIT');
    return { summary: { tables: tables.length, rows: totalRows }, counts };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// The whole dump as one string (used by the backup script).
export async function buildSqlDump(): Promise<{ sql: string; summary: SqlDumpSummary; counts: Record<string, number> }> {
  const parts: string[] = [];
  const { summary, counts } = await dumpSqlTo((s) => {
    parts.push(s);
  });
  return { sql: parts.join(''), summary, counts };
}
