import { decide, type DecisionResult } from "./decide";
import { readFacts, type Post, type Ref } from "./koios";

export const parseRef = (value: string): Ref => {
  const [txHash, index] = value.split("#");
  if (!/^[0-9a-f]{64}$/i.test(txHash) || !/^\d+$/.test(index ?? "")) throw new Error("out-ref must be txhash#index");
  return { txHash, index: Number(index) };
};

// The trigger names one thing: the coverage UTxO. Any other field it carries (a taskRef, a termsHash, an expiry) is never read.
export type Trigger = { coverageRef: string };
export function adjudicate(post: Post, trigger: Trigger, now: number) {
  if (!trigger || typeof trigger.coverageRef !== "string") throw new Error("trigger needs coverageRef");
  const outcome = readFacts(post, parseRef(trigger.coverageRef), now);
  return { ...outcome, ...decide(outcome.facts) } as ReturnType<typeof readFacts> & DecisionResult;
}
