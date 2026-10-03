/**
 * Sends a ride's Live Activity push after the session is read or ended
 * (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`, milestone 4).
 *
 * The decision is `planLiveActivityPush`; this only carries it out: send to the
 * registered token, record what Apple accepted, forget a token Apple rejects.
 * Nothing here can fail a rider's request: every failure is logged by its kind
 * (`ApnsOutcome`) and the next read tries again with newer content. Logs carry
 * the token's fingerprint, never the token.
 *
 * While the app is suspended, the scheduler's tick reads the session instead
 * (milestone 5, `POST /operator/live-activity/tick`) and calls `afterRead` the
 * same way.
 */

import type { ApnsOutcome, LiveActivityPush } from "./apns.ts";
import type { JourneySessionCoordinator, JourneySessionView } from "./journeySession.ts";
import { planLiveActivityEnd, planLiveActivityPush } from "./liveActivityContent.ts";

type Sessions = Pick<JourneySessionCoordinator, "liveActivityTarget" | "recordLiveActivityDelivery" | "dropLiveActivityToken">;

/**
 * A push rides on the rider's own request, so it gets a short budget. Past it
 * the request answers; the push may still land, unrecorded, and the next read
 * plans from the last recorded one (Apple ignores a timestamp it has applied).
 */
export const LIVE_ACTIVITY_PUSH_BUDGET_MS = 3_000;

class PushBudgetExceeded extends Error {
  override name = "PushBudgetExceeded";
}

export class LiveActivityPusher {
  private readonly sender: { send(push: LiveActivityPush): Promise<ApnsOutcome> };
  private readonly sessions: Sessions;
  private readonly now: () => number;
  private readonly log: (entry: Record<string, unknown>) => void;
  private readonly budgetMs: number;

  constructor(
    sender: { send(push: LiveActivityPush): Promise<ApnsOutcome> },
    sessions: Sessions,
    options: { now?: () => number; log?: (entry: Record<string, unknown>) => void; budgetMs?: number } = {},
  ) {
    this.budgetMs = options.budgetMs ?? LIVE_ACTIVITY_PUSH_BUDGET_MS;
    this.sender = sender;
    this.sessions = sessions;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((entry) => console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry })));
  }

  /** After a read or a confirmation committed `view`. Resolves; never throws. */
  async afterRead(view: JourneySessionView): Promise<void> {
    try {
      const target = await this.sessions.liveActivityTarget(view.id);
      if (!target) return;
      const plan = planLiveActivityPush(view, target.stops, target.delivery);
      if (!plan.send) return;
      const outcome = await this.withinBudget(this.sender.send({ ...plan.push, token: target.token }));
      if (outcome.kind === "delivered") {
        await this.sessions.recordLiveActivityDelivery(view.id, target.fingerprint, plan.next);
      } else if (outcome.kind === "token_rejected") {
        await this.sessions.dropLiveActivityToken(view.id, target.fingerprint);
      }
    } catch (error) {
      this.log({ level: "warn", event: "live_activity_push_skipped", sessionId: view.id, reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  /** Before the session row (and the token in it) is deleted. Resolves; never throws. */
  async beforeEnd(id: string): Promise<void> {
    try {
      const target = await this.sessions.liveActivityTarget(id);
      if (!target) return;
      await this.withinBudget(this.sender.send({ ...planLiveActivityEnd(target, target.delivery, this.now()), token: target.token }));
    } catch (error) {
      this.log({ level: "warn", event: "live_activity_end_skipped", sessionId: id, reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  private withinBudget<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PushBudgetExceeded()), this.budgetMs);
    });
    return Promise.race([work, budget]).finally(() => clearTimeout(timer));
  }
}
