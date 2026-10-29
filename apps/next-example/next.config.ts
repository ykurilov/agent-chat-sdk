import type { NextConfig } from "next";

// Keep this integration fixture within the shared test machine budget.
const config: NextConfig = { experimental: { cpus: 2 } };

export default config;
