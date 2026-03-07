import { fetchServiceAreasOverlay } from '@/lib/admin/maps';

const mockInvokeEdgeFunction = jest.fn();

jest.mock('@/lib/supabase/edge', () => ({
  invokeEdgeFunction: (...args: unknown[]) => mockInvokeEdgeFunction(...args),
}));

describe('fetchServiceAreasOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pages service area overlays within the backend limit', async () => {
    mockInvokeEdgeFunction
      .mockResolvedValueOnce({
        ok: true,
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { id: 'a' } }],
        },
        page: { limit: 200, offset: 0, returned: 200 },
      })
      .mockResolvedValueOnce({
        ok: true,
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { id: 'b' } }],
        },
        page: { limit: 200, offset: 200, returned: 1 },
      });

    const result = await fetchServiceAreasOverlay({} as any);

    expect(result).toEqual({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'a' } },
        { type: 'Feature', properties: { id: 'b' } },
      ],
    });
    expect(mockInvokeEdgeFunction).toHaveBeenCalledTimes(2);
    expect(mockInvokeEdgeFunction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'admin-api',
      expect.objectContaining({
        path: 'admin-service-areas-list',
        body: { q: '', limit: 200, offset: 0 },
      }),
    );
    expect(mockInvokeEdgeFunction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'admin-api',
      expect.objectContaining({
        path: 'admin-service-areas-list',
        body: { q: '', limit: 200, offset: 200 },
      }),
    );
  });
});
