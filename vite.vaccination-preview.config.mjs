import base from './vite.config.js';
export default options=>({...base(options),base:'/',cacheDir:'.local-preview/vite-vaccination',optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:5178,strictPort:true,watch:{ignored:['**/*.log','**/.local-preview/**']}}});
