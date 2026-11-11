import type { NextConfig } from "next";

// Keep this integration fixture within the shared test machine budget.
// NEXT_EXAMPLE_STANDALONE=1 — сборка `output: "standalone"` для проверки check-next.
const config: NextConfig = {
  experimental: { cpus: 2 },
  ...(process.env.NEXT_EXAMPLE_STANDALONE === "1" && { output: "standalone" as const }),
};

export default config;
