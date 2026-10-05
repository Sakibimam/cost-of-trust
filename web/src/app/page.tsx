import { Board } from "@/components/Board";
import { Runs } from "@/components/Runs";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main>
      <Board runs={<Runs />} />
    </main>
  );
}
