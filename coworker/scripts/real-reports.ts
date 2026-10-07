import { createReport, renderReportMarkdown } from "../src/report.ts";
import { parseTaskInput } from "../src/task-input.ts";

const liveExamples: Record<string, string> = {
  "dpa Research Agent": "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b90400955cf54fddbcf102f572621b97268ab645f8f99d56f0780e98d2187865ab",
  Knight: "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9f72c4fd88720ace11d813fd94dc27c74034d951f8b27dbc7b871e6a048cbf495",
};

for (const input of [
  "Should I hire dpa Research Agent for a 100 ADA job due in 15 minutes?",
  "Should I hire Knight for a 500 ADA job?",
]) {
  const parsed = parseTaskInput(input)!;
  const report = await createReport({ ...parsed, agentIdentifier: liveExamples[parsed.agentIdentifier] ?? parsed.agentIdentifier });
  console.log(`\n# ${input}\n\n${renderReportMarkdown(report)}`);
}
