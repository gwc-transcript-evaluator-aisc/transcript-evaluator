import { describe, expect, it, vi } from 'vitest';
import { CatalogCacheStore } from '../src/catalog/catalog-cache-store.js';
import { CatalogKeyResolver, catalogDirectoryRecord } from '../src/catalog/catalog-key-resolver.js';

const directory = (institutions: ReturnType<typeof catalogDirectoryRecord>[]) => ({ snapshotId: 'snapshot', institutions });

describe('CatalogKeyResolver', () => {
  it('resolves exact combined keys without AI and preserves exact provenance', async () => {
    const ai = { resolveInstitution: vi.fn() };
    const result = await new CatalogKeyResolver(ai).resolve(
      { institution: 'Example University', academicYear: '2023-2024', courseCode: 'CS 101' },
      directory([catalogDirectoryRecord('Example University', ['2023-2024'])]),
    );
    expect(result).toMatchObject({ identifier: { institution: 'Example University', academicYear: '2023-2024' }, resolution: { kind: 'resolved', method: 'exact' } });
    expect(ai.resolveInstitution).not.toHaveBeenCalled();
  });

  it('uses normalized institutions before AI and chooses the chronologically latest available year', async () => {
    const ai = { resolveInstitution: vi.fn() };
    const result = await new CatalogKeyResolver(ai).resolve(
      { institution: 'EXAMPLE university!', academicYear: '2018', courseCode: 'CS 101' },
      directory([catalogDirectoryRecord('Example University', ['2020', '2023-2024', '2022-2023'])]),
    );
    expect(result).toMatchObject({ identifier: { academicYear: '2023-2024' }, resolution: { method: 'exact-institution-year-fallback' } });
    expect(ai.resolveInstitution).not.toHaveBeenCalled();
  });

  it('uses AI only after exact institution matching fails and preserves an unresolved reason', async () => {
    const ai = { resolveInstitution: vi.fn().mockResolvedValue('Known College') };
    const resolver = new CatalogKeyResolver(ai);
    await expect(resolver.resolve({ institution: 'Unknown College', academicYear: '2020', courseCode: 'BIO 1' }, directory([catalogDirectoryRecord('Known College', ['2022'])]))).resolves.toMatchObject({ resolution: { method: 'ai-institution-year-fallback' } });
    ai.resolveInstitution.mockResolvedValueOnce('none');
    await expect(resolver.resolve({ institution: 'Missing', academicYear: '2020', courseCode: 'BIO 1' }, directory([]))).resolves.toMatchObject({ resolution: { kind: 'unresolved', reasonCode: 'INSTITUTION_NOT_FOUND' } });
  });

  it('always selects the available year with the greatest chronological end year', async () => {
    const resolver = new CatalogKeyResolver({ resolveInstitution: vi.fn() });
    for (const years of [['2019', '2022-2023', '2020-2021'], ['2024-2025', '2026', '2025-2026']]) {
      const expected = [...years].sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))[0];
      const result = await resolver.resolve({ institution: 'A', academicYear: '2018', courseCode: 'X' }, directory([catalogDirectoryRecord('A', years)]));
      expect(result.identifier?.academicYear).toBe(expected);
    }
  });
});

describe('CatalogCacheStore', () => {
  it('writes bounded per-institution records before switching the active snapshot', async () => {
    const cacheSend = vi.fn().mockResolvedValue({});
    const catalogSend = vi.fn().mockResolvedValue({ Items: [
      { catalogId: 'example-university#2022', sk: 'METADATA', status: 'EXISTS', institution: 'Example University', academicYear: '2022' },
      { catalogId: 'example-university#2023-2024', sk: 'METADATA', status: 'EXISTS', institution: 'Example University', academicYear: '2023-2024' },
    ] });
    const store = new CatalogCacheStore({ cacheClient: { send: cacheSend } as never, catalogClient: { send: catalogSend } as never, cacheTableName: 'cache', catalogTableName: 'catalog', now: () => new Date('2025-01-01T00:00:00.000Z'), snapshotId: () => 'snapshot-1' });
    await expect(store.refresh()).resolves.toMatchObject({ snapshotId: 'snapshot-1', institutions: [expect.objectContaining({ academicYears: ['2022', '2023-2024'] })] });
    expect(cacheSend.mock.calls.at(-1)?.[0].input.Item).toMatchObject({ pk: 'CACHE#CATALOG_DIRECTORY', sk: 'ACTIVE', snapshotId: 'snapshot-1' });
  });
});
