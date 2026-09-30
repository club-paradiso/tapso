import SwiftUI
import TapsoTransit

/// Demo controls, kept off the ride screen. The app has no data path, so every
/// ride plays a synthetic script; this sheet picks which one and how fast.
struct DemoControlsView: View {
    @Bindable var model: TapsoAppModel

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("demo.scenario", selection: $model.scenario) {
                        ForEach(DemoRideScenario.allCases, id: \.self) { scenario in
                            Text(LocalizedStringKey("demo.scenario." + scenario.rawValue)).tag(scenario)
                        }
                    }
                } footer: {
                    Text("demo.scenario.footer")
                }

                Section {
                    Picker("demo.speed", selection: $model.speed) {
                        ForEach(DemoSpeed.allCases) { speed in
                            Group {
                                if speed == .manual {
                                    Text("demo.speed.manual")
                                } else {
                                    Text(verbatim: speed.rawValue)
                                }
                            }
                            .tag(speed)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: model.speed) { _, _ in model.speedChanged() }
                    .accessibilityIdentifier("speed-picker")

                    if model.hasActiveRide {
                        Button {
                            Task { await model.advanceDemo() }
                        } label: {
                            Label("demo.step", systemImage: "forward.frame.fill")
                        }
                        .disabled(!model.canAdvanceDemo)
                        .accessibilityIdentifier("advance-demo-step")
                    }
                } header: {
                    Text("demo.playback")
                }
            }
            .navigationTitle(Text("demo.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("common.done") { model.isDemoPanelPresented = false }
                }
            }
        }
    }
}
