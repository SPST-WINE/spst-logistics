import { DEBUG } from '../config.js';

const __baseFetch = window.fetch.bind(window);
const __reqId = ()=>'r'+Math.random().toString(36).slice(2,8);
const __clip = (t,n=300)=>{ try{return String(t).slice(0,n);}catch{return '';} };

export async function http(url, opts={}, ctx=''){
  const id = __reqId(); const t0 = performance.now();
  if(DEBUG) console.groupCollapsed(`%c[HTTP ${ctx||'req'}] ${id} →`,'color:#8ab4f8', url);
  if(DEBUG) console.debug('options', opts);
  try{
    const res = await __baseFetch(url, opts);
    const ms = Math.round(performance.now()-t0);
    if(DEBUG) console.debug('status', res.status, res.statusText, ms+'ms');
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      if(DEBUG) console.warn('body snippet', __clip(txt));
      throw new Error(`HTTP ${res.status}: ${__clip(txt)}`);
    }
    if(DEBUG) console.groupEnd();
    return res;
  }catch(err){
    const ms = Math.round(performance.now()-t0);
    if(DEBUG) console.error('[HTTP error]', ms+'ms', err);
    if(DEBUG) console.groupEnd();
    throw err;
  }
}

// wrap globale una volta
if(!window.__FETCH_WRAPPED__){
  window.__FETCH_WRAPPED__ = true;
  window.fetch = (u,o)=>http(u,o,'global');
  if(DEBUG) console.info('[debug] fetch wrapped for logging');
}

