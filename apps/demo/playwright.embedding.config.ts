import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/embedding',testMatch:'*.spec.ts',workers:1,retries:0,timeout:30000,
 outputDir:'./test-results/embedding',
 projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}],
 reporter:[['line']], use:{baseURL:'http://127.0.0.1:6153',viewport:{width:1280,height:800},video:'on',screenshot:'only-on-failure'},
 webServer:{command:'pnpm exec vite --config embedding.vite.config.ts',url:'http://127.0.0.1:6153',reuseExistingServer:false},
});
