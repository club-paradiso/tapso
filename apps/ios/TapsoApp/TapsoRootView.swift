import SwiftUI
import TapsoTransit

/// Home, setup, ride, end. One ride at a time; the ride replaces setup rather
/// than stacking on it, so there is never a modal over a modal.
struct TapsoRootView: View {
    @Bindable var model: TapsoAppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.hasActiveRide {
                RideView(model: model)
            } else if let outcome = model.outcome {
                RideEndView(model: model, outcome: outcome)
            } else {
                NavigationStack(path: $model.path) {
                    HomeView(model: model)
                        .navigationDestination(for: SetupStep.self) { step in
                            destination(for: step)
                        }
                }
                .onChange(of: model.path) { _, newPath in
                    model.pathDidChange(newPath)
                }
                .sheet(isPresented: $model.isDemoPanelPresented) {
                    DemoControlsView(model: model)
                        .presentationDetents([.medium])
                }
            }
        }
        .tint(TapsoColor.mintDeep)
        .animation(TapsoMotion.animation(TapsoMotion.standard, reduceMotion: reduceMotion), value: model.hasActiveRide)
        .task { await model.resumeIfNeeded() }
        .task { await model.refreshCatalog() }
        .onChange(of: scenePhase, initial: true) { _, phase in
            Task { await model.rideSceneChanged(isActive: phase == .active) }
            guard phase == .active else { return }
            // A place left by the share extension is picked up when TAPSO comes forward,
            // and a last-bus countdown long past its time is cleared.
            model.collectHandoff()
            Task { await model.refreshReturnReminder() }
        }
    }

    @ViewBuilder
    private func destination(for step: SetupStep) -> some View {
        switch step {
        case .search:
            DestinationSearchView(model: model)
        case let .routes(destinationName):
            RouteSelectView(model: model, destinationName: destinationName)
        case let .boarding(routeID, destinationStopID):
            BoardingStopView(model: model, routeID: routeID, destinationStopID: destinationStopID)
        case .mapImport:
            MapImportView(model: model)
        case .vehicleCheck:
            VehicleCheckView(model: model)
        case .autoStart:
            AutoStartGuideView(library: model.library)
        case .liveRoutes:
            LiveRouteSearchView(model: model)
        case let .liveStops(routeID):
            LiveStopPickerView(model: model, routeID: routeID)
        case let .catalogBoarding(placeName):
            CatalogBoardingView(model: model, placeName: placeName)
        case let .catalogTrips(placeName, boardingName):
            CatalogTripsView(model: model, placeName: placeName, boardingName: boardingName)
        }
    }
}
