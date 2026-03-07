import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ServiceAreasClient from '@/app/(protected)/service-areas/serviceAreasClient';

const mockCreateClient = jest.fn(() => ({}));
const mockFetchOperationsRendererConfig = jest.fn();
const mockFetchMapboxRendererConfig = jest.fn();

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => mockCreateClient(),
}));

jest.mock('@/lib/admin/maps', () => ({
  fetchOperationsRendererConfig: (...args: unknown[]) =>
    mockFetchOperationsRendererConfig(...args),
  fetchMapboxRendererConfig: (...args: unknown[]) =>
    mockFetchMapboxRendererConfig(...args),
}));

jest.mock('@/components/maps/MapboxPolygonEditor', () => ({
  MapboxPolygonEditor: () => <div data-testid="mapbox-polygon-editor" />,
}));

jest.mock('@/components/maps/FallbackPolygonEditor', () => ({
  FallbackPolygonEditor: () => <div data-testid="fallback-polygon-editor" />,
}));

jest.mock('@/app/(protected)/service-areas/actions', () => ({
  upsertServiceAreaAction: jest.fn(),
  deleteServiceAreaAction: jest.fn(),
}));

const baseProps = {
  query: { q: '', offset: 0 },
  initialAreas: [],
  page: { limit: 50, offset: 0, returned: 0 },
  pricingConfigs: [],
};

describe('ServiceAreasClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to the approved renderer when mapbox draw is unavailable', async () => {
    mockFetchOperationsRendererConfig.mockResolvedValue({
      provider: 'google',
      fallbackOrder: ['mapbox', 'here'],
      requestId: 'req-google',
      telemetryToken: 'token-google',
      telemetryExpiresAt: '2026-03-07T10:00:00.000Z',
      config: { apiKey: 'google-key', language: 'ar', region: 'IQ' },
    });
    render(<ServiceAreasClient {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'New service area' }));

    expect(await screen.findByTestId('fallback-polygon-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('mapbox-polygon-editor')).not.toBeInTheDocument();
    expect(mockFetchMapboxRendererConfig).not.toHaveBeenCalled();
  });

  it('uses mapbox draw immediately when the active renderer is mapbox', async () => {
    mockFetchOperationsRendererConfig.mockResolvedValue({
      provider: 'mapbox',
      fallbackOrder: ['here', 'google'],
      requestId: 'req-mapbox',
      telemetryToken: 'token-mapbox',
      telemetryExpiresAt: '2026-03-07T10:00:00.000Z',
      config: { token: 'mapbox-token', styleUrl: 'mapbox://styles/mapbox/standard' },
    });

    render(<ServiceAreasClient {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'New service area' }));

    expect(await screen.findByTestId('mapbox-polygon-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('fallback-polygon-editor')).not.toBeInTheDocument();
    expect(mockFetchMapboxRendererConfig).not.toHaveBeenCalled();
  });
});
