// HERE flexible polyline decoder (v1) for 2D lines.
// Spec & pseudocode: https://github.com/heremaps/flexible-polyline

import type { GeoLineString } from './types.ts';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODING_TABLE: Int8Array = (() => {
  const tbl = new Int8Array(128);
  tbl.fill(-1);
  for (let i = 0; i < CHARSET.length; i += 1) {
    tbl[CHARSET.charCodeAt(i)] = i;
  }
  return tbl;
})();

function decodeInteger(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 0 || code >= DECODING_TABLE.length) return -1;
  return DECODING_TABLE[code];
}

function decodeUnsignedVarint(s: string, startIndex: number): { value: number; index: number } {
  let index = startIndex;
  let result = 0;
  let shift = 0;

  while (index < s.length) {
    const chunk = decodeInteger(s[index]);
    if (chunk < 0) throw new Error('flexpoly_bad_char');

    const hasNext = (chunk & 0x20) !== 0;
    const value = chunk & 0x1f;
    result |= value << shift;
    shift += 5;
    index += 1;

    if (!hasNext) return { value: result, index };
    if (shift > 60) throw new Error('flexpoly_varint_overflow');
  }

  throw new Error('flexpoly_truncated');
}

function decodeSignedVarint(s: string, startIndex: number): { value: number; index: number } {
  const u = decodeUnsignedVarint(s, startIndex);
  const unsigned = u.value;
  const signed = (unsigned & 1) ? -((unsigned + 1) >> 1) : (unsigned >> 1);
  return { value: signed, index: u.index };
}

export function decodeHereFlexiblePolylineToLineString(encoded: string): GeoLineString {
  if (!encoded || typeof encoded !== 'string') throw new Error('flexpoly_invalid');

  // Header (varints): version, header content
  const v = decodeUnsignedVarint(encoded, 0);
  const version = v.value;
  if (version !== 1) throw new Error('flexpoly_unsupported_version');

  const h = decodeUnsignedVarint(encoded, v.index);
  const header = h.value;

  const precision2d = header & 0x0f;
  const thirdDimFlag = (header >> 4) & 0x07;
  // const thirdDimPrecision = (header >> 7) & 0x0f;

  const dims = thirdDimFlag === 0 ? 2 : 3;
  const factor = Math.pow(10, precision2d);

  let lat = 0;
  let lng = 0;
  // let z = 0;

  let index = h.index;
  const coordinates: Array<[number, number]> = [];

  while (index < encoded.length) {
    const dLat = decodeSignedVarint(encoded, index);
    lat += dLat.value;
    index = dLat.index;

    const dLng = decodeSignedVarint(encoded, index);
    lng += dLng.value;
    index = dLng.index;

    if (dims === 3) {
      const dZ = decodeSignedVarint(encoded, index);
      // z += dZ.value;
      index = dZ.index;
    }

    coordinates.push([lng / factor, lat / factor]);
  }

  return { type: 'LineString', coordinates };
}
