// No automatic retry: an interrupted mutation may already have committed server-side.
export async function customerFetch(url,options={},fetcher=fetch){
 try{return await fetcher(url,{...options,signal:options.signal||AbortSignal.timeout(90000)});}
 catch{throw Error('The connection was interrupted. The server may have saved the request. Keep any unsaved text, refresh the saved status, then retry only if needed.');}
}
