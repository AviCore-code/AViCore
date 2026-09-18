import { describe, it, expect, vi } from 'vitest';
import { resolveCompanyId } from './companyContext.js';

describe('company resolution', () => {
  it('uses server membership for an authenticated admin, never the Crew slug', async () => {
    const sb = { auth: { getSession: async () => ({ data: { session: {} } }) }, rpc: vi.fn(async () => ({ data: 'admin-company' })), from: vi.fn() };
    expect(await resolveCompanyId(sb, 'different-company')).toBe('admin-company');
    expect(sb.rpc).toHaveBeenCalledWith('current_company_id');
    expect(sb.from).not.toHaveBeenCalled();
  });
  it('refuses an admin without membership', async () => {
    const sb = { auth: { getSession: async () => ({ data: { session: {} } }) }, rpc: async () => ({ data: null }), from: vi.fn() };
    await expect(resolveCompanyId(sb, 'uoa')).rejects.toThrow('not assigned');
    expect(sb.from).not.toHaveBeenCalled();
  });
  it('resolves the configured Crew company', async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: async () => ({ data: { id: 'crew-company' } }) };
    const sb = { auth: { getSession: async () => ({ data: { session: null } }) }, from: vi.fn(() => query) };
    expect(await resolveCompanyId(sb, 'uoa')).toBe('crew-company');
    expect(sb.from).toHaveBeenCalledWith('companies');
    expect(query.eq).toHaveBeenCalledWith('slug', 'uoa');
  });
  it('fails closed when Crew company configuration is absent', async () => {
    const sb = { auth: { getSession: async () => ({ data: { session: null } }) } };
    await expect(resolveCompanyId(sb, '')).rejects.toThrow('not configured');
  });
});
