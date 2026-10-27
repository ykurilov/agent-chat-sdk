import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/viewport',testMatch:'*.spec.ts',workers:1,retries:0,timeout:45000,
 outputDir:'./test-results/viewport',reporter:[['line']],
 projects:[{name:'webkit',use:{browserName:'webkit'}},{name:'chromium',use:{browserName:'chromium'}}],
 use:{baseURL:'http://127.0.0.1:6155',viewport:{width:402,height:874},isMobile:true,hasTouch:true,video:'on',screenshot:'only-on-failure'},
 webServer:{command:'pnpm exec vite --config viewport.vite.config.ts',url:'http://127.0.0.1:6155',reuseExistingServer:false},
});
