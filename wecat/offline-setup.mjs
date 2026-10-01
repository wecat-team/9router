// Setup chạy trước khi import code application để không giữ nhầm native fetch.
const nativeFetch=globalThis.fetch.bind(globalThis);
function guardedFetch(input,options){
 const url=new URL(typeof input==='string'?input:input.url||String(input));
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Offline gate chặn network ra ngoài; test phải mock provider');
 return nativeFetch(input,options);
}
vi.stubGlobal('fetch',guardedFetch);
beforeEach(()=>vi.stubGlobal('fetch',guardedFetch));
