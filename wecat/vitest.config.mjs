import upstream from '../tests/vitest.config.js';
export default {...upstream,test:{...upstream.test,setupFiles:[new URL('./offline-setup.mjs',import.meta.url).pathname]}};
