/** Only repeat a read denied by the native single-worker admission gate.
 * Mutations/confirmations and security failures must never enter this retry. */
export async function retryFiscalRead<T>(read:()=>Promise<T>,active:()=>boolean=()=>true):Promise<T>{for(let attempt=0;;attempt++){if(!active())throw {code:'CANCELLED'};try{return await read()}catch(e){if((e as {code?:string})?.code!=='BUSY'||attempt>=24)throw e;await new Promise(resolve=>setTimeout(resolve,300))}}}
