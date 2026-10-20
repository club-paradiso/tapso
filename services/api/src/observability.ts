import { createHash } from "node:crypto";

export type TapsoEvent =
  | "ride_session_started"
  | "vehicle_candidates_found"
  | "vehicle_match_high_confidence"
  | "vehicle_match_selected"
  | "vehicle_match_shadow"
  | "vehicle_match_confirmation_required"
  | "vehicle_match_confirmed"
  | "journey_session_created"
  | "journey_session_read"
  | "journey_session_ended"
  | "journey_session_create_refused"
  | "beta_feedback_received"
  | "live_activity_token_registered"
  | "live_activity_tick"
  | "vehicle_lost"
  | "transit_data_stale"
  | "destination_approaching"
  | "destination_next"
  | "destination_arrived"
  | "ride_session_completed";

export function logEvent(event: TapsoEvent, fields: Record<string, string | number | boolean | undefined>): void {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}

/**
 * A session id is a bearer capability: whoever holds it can read, confirm or end
 * the ride and register a push token on it. Logs therefore carry a short one-way
 * reference instead, enough to join lines about one ride and useless to act on.
 */
export function sessionRef(id: string): string {
  return createHash("sha256").update(`tapso-session:${id}`).digest("hex").slice(0, 12);
}
