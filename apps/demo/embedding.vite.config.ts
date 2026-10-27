import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, searchForWorkspaceRoot } from 'vite';
export default defineConfig({
 root: fileURLToPath(new URL('./tests/embedding', import.meta.url)),
 plugins:[react()],
 resolve:{conditions:[...defaultClientConditions,'@ykurilov/agent-chat-source']},
 server:{host:'127.0.0.1',port:6153,strictPort:true,fs:{allow:[searchForWorkspaceRoot(process.cwd())]}},
});
