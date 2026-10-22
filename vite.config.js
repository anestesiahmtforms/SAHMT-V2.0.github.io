import {defineConfig,loadEnv} from 'vite';
import {GOOGLE_PROJECT_CONFIG} from './src/google-project-auth-config.js';
import {assertGoogleProjectAuthRelease} from './scripts/lib/google-project-auth-release.js';

const target = process.env.SAHMT_DEPLOYMENT_TARGET || 'FA';
if (!['FA','FB'].includes(target)) throw Error('BUILD_TARGET_INVALID');
export default defineConfig(({mode,command})=>{
  const env={...loadEnv(mode,process.cwd(),''),...process.env};
  if(command==='build')assertGoogleProjectAuthRelease({enabled:env.VITE_GOOGLE_PROJECT_AUTH_ENABLED,entries:GOOGLE_PROJECT_CONFIG,target,
    legacyEnabled:['VITE_FIREBASE_PROJECT_AUTH_ENABLED','VITE_FIREBASE_PROJECT_AUTH_AUTO_CONNECT_ENABLED','VITE_MANAGEMENT_FA_FIRST_LOGIN_ENABLED'].some(key=>env[key]==='true')});
  return {
  define: {__SAHMT_DEPLOYMENT__: JSON.stringify({target, externalManagementEnabled:process.env.SAHMT_FB_CUTOVER === 'true'})},
  base: target === 'FB' ? '/SAHMT-V2.0.github.io/gestao/' : '/SAHMT-V2.0.github.io/',
  build: {outDir: target === 'FB' ? 'dist/gestao' : 'dist', emptyOutDir: true, manifest: 'assets-manifest.json',rollupOptions:{input:{app:'index.html'}}},
  server: {host: '0.0.0.0'}
};});
