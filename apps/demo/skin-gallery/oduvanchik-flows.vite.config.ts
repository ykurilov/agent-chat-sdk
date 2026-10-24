import { mergeConfig } from "vite";
import base from "./vite.config";
export default mergeConfig(base, { server: {
  port: Number(process.env.SKIN_GALLERY_PORT ?? 5953),
  proxy: { "/api": { target: `http://127.0.0.1:${process.env.FLOW_TEST_API_PORT ?? 8953}`, ws: true } },
} });
