import type { RouteRequest, StopOnRoute, VehicleObservation } from "./domain.ts";
import type { TransitProvider } from "./provider.ts";

export class MockTransitProvider implements TransitProvider {
  // Plain fields rather than constructor parameter properties: Node's type
  // stripping refuses that syntax, so the class could not be loaded at all.
  private readonly stopFixtures: StopOnRoute[];
  private readonly vehicleFixtures: VehicleObservation[];

  constructor(stopFixtures: StopOnRoute[], vehicleFixtures: VehicleObservation[]) {
    this.stopFixtures = stopFixtures;
    this.vehicleFixtures = vehicleFixtures;
  }

  async stops(_request: RouteRequest): Promise<StopOnRoute[]> {
    return structuredClone(this.stopFixtures);
  }

  async vehicles(request: RouteRequest): Promise<VehicleObservation[]> {
    return structuredClone(this.vehicleFixtures.filter((vehicle) => vehicle.routeId === request.routeId));
  }
}
