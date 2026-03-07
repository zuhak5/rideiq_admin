import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MapsClient from '@/app/(protected)/maps/mapsClient';

const mockCreateClient = jest.fn(() => ({}));
const mockPreviewControls: { emitBounds?: () => void } = {};
const mockListMapsProviders = jest.fn();
const mockListMapsCapabilities = jest.fn();
const mockListMapsRequestStats = jest.fn();
const mockListMapsProviderHealth = jest.fn();
const mockFetchMapsRenderPreview = jest.fn();
const mockFetchOperationsRendererConfig = jest.fn();
const mockListMapsRequestLogs = jest.fn();
const mockFetchServiceAreasOverlay = jest.fn();
const mockFetchLiveDrivers = jest.fn();
const mockUpdateMapsProvider = jest.fn();
const mockUpdateMapsCapability = jest.fn();
const mockResetMapsProviderHealth = jest.fn();

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => mockCreateClient(),
}));

jest.mock('@/components/maps/ApprovedMapPreview', () => ({
  ApprovedMapPreview: ({ onBoundsChange }: { onBoundsChange?: (bbox: unknown) => void }) => {
    React.useEffect(() => {
      const bbox = {
        min_lat: 33.25,
        min_lng: 44.2,
        max_lat: 33.45,
        max_lng: 44.5,
      };
      onBoundsChange?.(bbox);
      mockPreviewControls.emitBounds = () => onBoundsChange?.(bbox);
    }, [onBoundsChange]);
    return <div data-testid="approved-map-preview" />;
  },
}));

jest.mock('@/lib/admin/maps', () => ({
  primaryMapsProviders: ['google', 'mapbox', 'here'],
  fetchLiveDrivers: (...args: unknown[]) => mockFetchLiveDrivers(...args),
  fetchOperationsRendererConfig: (...args: unknown[]) =>
    mockFetchOperationsRendererConfig(...args),
  fetchMapsRenderPreview: (...args: unknown[]) => mockFetchMapsRenderPreview(...args),
  fetchServiceAreasOverlay: (...args: unknown[]) => mockFetchServiceAreasOverlay(...args),
  isEditableMapsProvider: (providerCode: string) =>
    ['google', 'mapbox', 'here'].includes(providerCode),
  listMapsCapabilities: (...args: unknown[]) => mockListMapsCapabilities(...args),
  listMapsProviderHealth: (...args: unknown[]) => mockListMapsProviderHealth(...args),
  listMapsProviders: (...args: unknown[]) => mockListMapsProviders(...args),
  listMapsRequestLogs: (...args: unknown[]) => mockListMapsRequestLogs(...args),
  listMapsRequestStats: (...args: unknown[]) => mockListMapsRequestStats(...args),
  resetMapsProviderHealth: (...args: unknown[]) => mockResetMapsProviderHealth(...args),
  sortMapsProviders: (rows: unknown[]) => rows,
  updateMapsCapability: (...args: unknown[]) => mockUpdateMapsCapability(...args),
  updateMapsProvider: (...args: unknown[]) => mockUpdateMapsProvider(...args),
}));

describe('MapsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete mockPreviewControls.emitBounds;
    mockListMapsProviders.mockResolvedValue([
      {
        provider_code: 'google',
        priority: 1,
        enabled: true,
        language: 'ar',
        region: 'IQ',
        monthly_soft_cap_units: null,
        monthly_hard_cap_units: 1000,
        cache_enabled: false,
        cache_ttl_seconds: null,
        note: null,
        mtd_render: 120,
        mtd_directions: 15,
        mtd_geocode: 20,
        mtd_distance_matrix: 0,
        updated_at: '2026-03-06T09:00:00.000Z',
      },
    ]);
    mockListMapsCapabilities.mockResolvedValue([
      {
        provider_code: 'google',
        capability: 'render',
        enabled: true,
        unit_label: null,
        note: null,
      },
    ]);
    mockListMapsRequestStats.mockResolvedValue([
      {
        provider_code: 'google',
        capability: 'render',
        requests_1h: 10,
        requests_24h: 90,
        billed_units_1h: 10,
        billed_units_24h: 90,
        cache_hits_1h: 0,
        cache_hits_24h: 0,
        errors_1h: 0,
        errors_24h: 1,
        rate_limited_1h: 0,
        rate_limited_24h: 0,
      },
    ]);
    mockListMapsProviderHealth.mockResolvedValue([
      {
        provider_code: 'google',
        capability: 'render',
        consecutive_failures: 0,
        disabled_until: null,
        last_http_status: null,
        last_error_code: null,
        last_failure_at: null,
        updated_at: '2026-03-06T09:00:00.000Z',
      },
    ]);
    mockFetchMapsRenderPreview.mockResolvedValue({
      provider: 'google',
      fallbackOrder: ['google', 'mapbox', 'here'],
      requestId: 'req-123',
      telemetryExpiresAt: '2026-03-06T10:00:00.000Z',
      config: { language: 'ar', region: 'IQ', mapId: 'demo-map' },
    });
    mockFetchOperationsRendererConfig.mockResolvedValue({
      provider: 'google',
      fallbackOrder: ['mapbox', 'here'],
      requestId: 'req-google',
      telemetryToken: 'token-google',
      telemetryExpiresAt: '2026-03-06T10:00:00.000Z',
      config: { apiKey: 'test-google-key', language: 'ar', region: 'IQ' },
    });
    mockListMapsRequestLogs.mockResolvedValue([
      {
        created_at: '2026-03-06T09:00:00.000Z',
        request_id: 'log-1',
        actor_user_id: null,
        client_renderer: 'google',
        action: 'route',
        capability: 'render',
        provider_code: 'google',
        http_status: 200,
        latency_ms: 180,
        billed_units: 1,
        error_code: null,
        error_detail: null,
        tried_providers: ['google'],
        cache_hit: false,
        attempt_number: 1,
        fallback_reason: null,
        request_summary: { endpoint: '/route', ride_id: 'ride-1' },
        response_summary: null,
      },
    ]);
    mockFetchServiceAreasOverlay.mockResolvedValue(null);
    mockFetchLiveDrivers.mockResolvedValue({ drivers: [], since: '5m' });
    mockUpdateMapsProvider.mockResolvedValue(undefined);
    mockUpdateMapsCapability.mockResolvedValue(undefined);
    mockResetMapsProviderHealth.mockResolvedValue(undefined);
  });

  it('renders logs and saves provider edits', async () => {
    render(<MapsClient />);

    expect(await screen.findByText('Primary render providers')).toBeInTheDocument();
    expect(await screen.findByLabelText('Enable google')).toBeInTheDocument();
    expect(screen.getByTestId('maps-request-log-table')).toHaveTextContent('/route');

    fireEvent.click(screen.getByLabelText('Enable google'));
    fireEvent.change(screen.getByLabelText('google priority'), {
      target: { value: '3', valueAsNumber: 3 },
    });
    fireEvent.click(screen.getByLabelText('Save google'));

    await waitFor(() => {
      expect(mockUpdateMapsProvider).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          providerCode: 'google',
          enabled: false,
          priority: 3,
        }),
      );
    });
  });

  it('does not refetch live drivers when the map reports the same bounds', async () => {
    render(<MapsClient />);

    await waitFor(() => {
      expect(mockFetchLiveDrivers).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mockPreviewControls.emitBounds?.();
      await Promise.resolve();
    });

    expect(mockFetchLiveDrivers).toHaveBeenCalledTimes(1);
  });
});
