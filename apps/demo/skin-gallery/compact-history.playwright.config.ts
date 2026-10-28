import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const port=Number(process.env.SKIN_GALLERY_PORT??5964);
export default defineConfig({testDir:".",testMatch:"compact-history.spec.ts",workers:1,reporter:"list",timeout:60000,
 use:{baseURL:`http://127.0.0.1:${port}`,trace:"retain-on-failure",viewport:{width:1200,height:900}},
 projects:[{name:"chromium",use:{browserName:"chromium"}},{name:"webkit",use:{browserName:"webkit"}}],
 webServer:{command:"pnpm exec vite --config skin-gallery/vite.config.ts --host 127.0.0.1",cwd:fileURLToPath(new URL("..",import.meta.url)),url:`http://127.0.0.1:${port}/compact-history.html`,env:{SKIN_GALLERY_PORT:String(port)},reuseExistingServer:false,timeout:60000}});
