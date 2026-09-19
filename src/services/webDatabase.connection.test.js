import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: new Map(), writes: [], options: null }));
vi.mock('./offlineWrap.js', () => ({ cacheableRead: (_key, fn) => fn, queueableWrite: (_kind, fn) => fn }));
vi.mock('./offlineQueue.js', () => ({ registerCurrentReader: vi.fn() }));
vi.mock('./downloadPdf.js', () => ({ downloadElementAsPdf: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (_url, _key, options) => {
  state.options = options;
  return {
    auth: { getSession: async () => ({ data: { session: {} } }) },
    rpc: async () => ({ data: 'company-a' }),
    from(table) {
      const filters = [];
      const q = {
        select: () => q, order: () => q,
        is: (key, value) => { filters.push(r => r[key] === value); return q; },
        gte: (key, value) => { filters.push(r => r[key] >= value); return q; },
        lte: (key, value) => { filters.push(r => r[key] <= value); return q; },
        range: async (from, to) => ({ data: [...(state.rows.get(table)?.values() || [])].filter(r => filters.every(f => f(r))).slice(from, to + 1) }),
        upsert: async (payload, options) => {
          state.writes.push({ table, payload, options });
          const rows = state.rows.get(table) || new Map();
          for (const row of Array.isArray(payload) ? payload : [payload]) rows.set(row.uuid || row.key, row);
          state.rows.set(table, rows);
          return { error: null };
        }
      };
      return q;
    }
  };
} }));

let db;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public-key');
  vi.stubEnv('VITE_COMPANY_SLUG', 'uoa');
  db = await import('./webDatabase.js');
});
beforeEach(() => { state.rows.clear(); state.writes.length = 0; });

describe('Admin and Crew shared data contract', () => {
  it('sends the configured company header', () => {
    expect(state.options.global.headers['x-avicore-company']).toBe('uoa');
  });
  it('Admin roster changes, clears and restores are reflected in the shared Crew read', async () => {
    const entry = { pilotCode: 'ABC', date: '2026-09-18', code: 'OFF' };
    await db.importRosterMany([entry]);
    expect(state.writes[0].table).toBe('Admin_pilot_roster');
    expect(state.writes[0].payload[0].company_id).toBe('company-a');
    expect((await db.listRoster({ from: entry.date, to: entry.date }))[0].code).toBe('OFF');
    await db.importRosterMany([{ ...entry, code: '', clearExisting: true }]);
    expect(await db.listRoster({ from: entry.date, to: entry.date })).toEqual([]);
    await db.importRosterMany([entry]);
    expect(await db.listRoster({ from: entry.date, to: entry.date })).toHaveLength(1);
  });
  it('saves settings using the company-specific unique key', async () => {
    await db.saveSetting('test-setting', { value: 1 });
    expect(state.writes[0]).toMatchObject({ table: 'Admin_app_settings', payload: { company_id: 'company-a', key: 'test-setting' }, options: { onConflict: 'company_id,key' } });
  });
});
