export type CheckInput = {
  agentIdentifier: string;
  taskValueAtRiskAda: number;
  task?: string;
  deadlineMinutes?: number;
  sellerId?: string;
  network?: "Preprod" | "Mainnet";
  riskAversion?: number;
  sharedInfrastructure?: boolean;
};

export type Evidence = {
  source: string;
  status: "ok" | "unavailable" | "not_found" | "invalid";
  observedAt: string;
  data?: unknown;
  error?: string;
};

export type TrustReport = {
  input: CheckInput;
  recommendation: "hire_as_is" | "hire_with_backup_keeper" | "require_coverage" | "do_not_hire" | "insufficient_data";
  expectedCostAda: number | null;
  selectedRoute?: "single" | "redundant" | "staggered" | "underwritten";
  options: Record<"single" | "redundant" | "staggered" | "underwritten", {
    sellers: string[];
    expectedTotalCostAda: number;
    riskAdjustedCostAda: number;
    arithmetic: string;
  } | null>;
  pricingNote: string;
  deadlineStats?: { within: number; total: number; deadlineSeconds: number; median: number | null; p90: number | null };
  alternateAgents?: string[];
  facts: Evidence[];
  summary: string;
  generatedAt: string;
  markdown?: string;
};
