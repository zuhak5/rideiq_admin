declare namespace google.maps {
  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface MapOptions {
    center: LatLngLiteral;
    zoom: number;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    gestureHandling?: string;
  }

  interface RectangleOptions {
    bounds?: LatLngBounds | LatLngBoundsLiteral;
    editable?: boolean;
    draggable?: boolean;
    strokeOpacity?: number;
    strokeWeight?: number;
    strokeColor?: string;
    fillOpacity?: number;
    fillColor?: string;
    clickable?: boolean;
    map?: Map | null;
  }

  interface CircleOptions {
    center: LatLngLiteral;
    radius: number;
    clickable?: boolean;
    fillOpacity?: number;
    strokeOpacity?: number;
    strokeWeight?: number;
    map?: Map | null;
  }

  interface MarkerOptions {
    position: LatLngLiteral;
    title?: string;
    map?: Map | null;
  }

  interface MapMouseEvent {
    latLng?: LatLng;
  }

  interface MapsEventListener {
    remove(): void;
  }

  interface LatLngBoundsLiteral {
    north: number;
    south: number;
    east: number;
    west: number;
  }

  class LatLng {
    lat(): number;
    lng(): number;
  }

  class LatLngBounds {
    getNorthEast(): LatLng;
    getSouthWest(): LatLng;
    extend(point: LatLngLiteral): LatLngBounds;
    isEmpty(): boolean;
  }

  class Map {
    constructor(el: HTMLElement, opts: MapOptions);
    addListener(eventName: 'click', handler: (event: MapMouseEvent) => void): MapsEventListener;
    addListener(eventName: string, handler: (...args: unknown[]) => void): MapsEventListener;
    data: Data;
    fitBounds(bounds: LatLngBounds | LatLngBoundsLiteral): void;
    setCenter(center: LatLngLiteral): void;
    setZoom(zoom: number): void;
  }

  class Data {
    addGeoJson(geoJson: any): void;
    setStyle(style: any): void;
    forEach(callback: (feature: any) => void): void;
    remove(feature: any): void;
  }

  class Rectangle {
    constructor(opts: RectangleOptions);
    getBounds(): LatLngBounds | null;
    setBounds(bounds: LatLngBounds | LatLngBoundsLiteral): void;
    setEditable(editable: boolean): void;
    setMap(map: Map | null): void;
    addListener(eventName: string, handler: () => void): MapsEventListener;
  }

  class Circle {
    constructor(opts: CircleOptions);
    setCenter(center: LatLngLiteral): void;
    setRadius(radius: number): void;
    setMap(map: Map | null): void;
  }

  class Marker {
    constructor(opts: MarkerOptions);
    setMap(map: Map | null): void;
  }
}
