export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(left: GeoPoint, right: GeoPoint): number {
  if (![left.latitude, left.longitude, right.latitude, right.longitude].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const latitude1 = degreesToRadians(left.latitude);
  const latitude2 = degreesToRadians(right.latitude);
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}
