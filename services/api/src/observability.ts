export type TapsoEvent =
  | "ride_session_started"
  | "vehicle_candidates_found"
  | "vehicle_match_high_confidence"
  | "vehicle_match_selected"
  | "vehicle_match_shadow"
  | "vehicle_match_confirmation_required"
  | "vehicle_match_confirmed"
  | "journey_session_created"
  | "journey_session_ended"
  | "live_activity_token_registered"
  | "vehicle_lost"
  | "transit_data_stale"
  | "destination_approaching"
  | "destination_next"
  | "destination_arrived"
  | "ride_session_completed";

export function logEvent(event: TapsoEvent, fields: Record<string, string | number | boolean | undefined>): void {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}
