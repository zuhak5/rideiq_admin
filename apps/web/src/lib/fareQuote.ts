import { invokeEdge } from './edgeInvoke';
import type { QuoteBreakdown } from '../components/QuoteBreakdownCard';
import { buildFareContext } from './fareContext';

export type FareQuoteResponse = {
  quote_id: string | null;
  quote: QuoteBreakdown;
  route?: { distance: number; duration: number } | { distance_m: number; duration_s: number };
  weather?: unknown;
  stored?: boolean;
};

function getFareEngineFunctionName(): string {
  const raw = ((import.meta as any).env?.VITE_FARE_ENGINE_FUNCTION_NAME as string | undefined) ?? '';
  const v = raw.trim();
  return v.length ? v : 'fare-engine';
}

/**
 * Route-based, audit-logged fare quote.
 *
 * This is the only supported pricing entrypoint.
 */
export async function getFareQuote(params: {
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  product_code: string;
}): Promise<FareQuoteResponse> {
  const { data } = await invokeEdge<FareQuoteResponse>(getFareEngineFunctionName(), {

      pickup_lat: params.pickup_lat,
      pickup_lng: params.pickup_lng,
      dropoff_lat: params.dropoff_lat,
      dropoff_lng: params.dropoff_lng,
      product_code: params.product_code,
      context: buildFareContext(),
  });
  if (!data?.quote) throw new Error('Missing quote from fare engine');

  return data as FareQuoteResponse;
}
