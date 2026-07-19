import { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet';

// Loaded via React.lazy from RideTrackMap so Leaflet (and its CSS) only ship
// when a ride with a track is actually opened.
export default function TrackMapInner({ points }: { points: [number, number][] }) {
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    let south = Infinity;
    let north = -Infinity;
    let west = Infinity;
    let east = -Infinity;
    for (const [lat, lng] of points) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
    return [
      [south, west],
      [north, east],
    ];
  }, [points]);

  return (
    <div className="h-56 w-full overflow-hidden rounded-lg border border-border">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [20, 20] }}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={points as LatLngExpression[]}
          pathOptions={{ color: '#f43f5e', weight: 3, opacity: 0.9 }}
        />
      </MapContainer>
    </div>
  );
}
