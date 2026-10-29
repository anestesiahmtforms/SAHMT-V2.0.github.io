import base from './vite.config.js';
export default options=>({...base(options),base:'/',cacheDir:'.local-preview/vite-indicators',optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:5182,strictPort:true,watch:{ignored:['**/*.log','**/.local-preview/**']}}});
