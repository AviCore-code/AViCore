import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ url: '', key: '' }));

vi.mock('@supabase/supabase-js', () => ({
  createClient(url, key) {
    captured.url = url;
    captured.key = key;
    return { from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) };
  },
}));

describe('Supabase build environment compatibility', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    captured.url = '';
    captured.key = '';
  });

  it('uses the encrypted production env ANON key when the publishable-key alias is absent', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'production-anon-key');

    await import('./supabase.js');

    expect(captured.url).toBe('https://example.supabase.co');
    expect(captured.key).toBe('production-anon-key');
  });

  it('keeps supporting a publishable-key-only environment', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');

    await import('./supabase.js');

    expect(captured.key).toBe('publishable-key');
  });

  it('prefers the publishable key when both compatible names are configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'production-anon-key');

    await import('./supabase.js');

    expect(captured.key).toBe('publishable-key');
  });

  it('fails fast when neither compatible key has a usable value', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    await expect(import('./supabase.js')).rejects.toThrow(
      'Missing VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY'
    );
  });
});
