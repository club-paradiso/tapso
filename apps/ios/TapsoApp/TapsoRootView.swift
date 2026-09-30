import SwiftUI
import TapsoTransit

/// Home, setup, ride, end. One ride at a time; the ride replaces setup rather
/// than stacking on it, so there is never a modal over a modal.
struct TapsoRootView: View {
    @Bindable var model: TapsoAppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("ride.menu.demo", systemImage: "testtube.2") { model.isDemoPanelPresented = true }
                            }
                        }
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
        }
    }
}
