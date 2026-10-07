import { Board } from "@/components/Board";
import { HowItWorks } from "@/components/HowItWorks";
import { Runs } from "@/components/Runs";
import { TryIt } from "@/components/TryIt";
import { agentNames } from "@/app/api/check/names";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main>
      <Board runs={<Runs />} tryIt={<TryIt names={agentNames()} />} howItWorks={<HowItWorks />} />
    </main>
  );
}
