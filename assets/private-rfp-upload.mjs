import {validateFile} from './rfp-document.mjs';
const hash = async buffer => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer)),b=>b.toString(16).padStart(2,"0")).join("");
export async function uploadRfp(file,{supabase,user,session,currentUser=()=>user}) {
  const {extension,mime}=validateFile(file), owner=user.id, fileHash=await hash(await file.arrayBuffer());
  const key="tendercrest-compliance:"+owner+":"+fileHash;
  let id=sessionStorage.getItem(key);
  if(!/^[0-9a-f-]{36}$/i.test(id || "")) {id=crypto.randomUUID();sessionStorage.setItem(key,id);}
  const path=owner+"/"+id+"/source."+extension;
  await session();
  const existing=await supabase.from("rfp_uploads").select("*").eq("id",id).maybeSingle();
  if(existing.error) throw Error("Upload metadata could not be read.");
  const metadata={id,user_id:owner,file_name:file.name,sha256:fileHash,mime_type:mime,size_bytes:file.size,storage_path:path};
  if(existing.data) {
    if(["user_id","sha256","mime_type","size_bytes","storage_path"].some(k=>existing.data[k]!==metadata[k]))
      throw Error("This upload does not match the saved source.");
  } else {
    const inserted=await supabase.from("rfp_uploads").insert(metadata);
    if(inserted.error && inserted.error.code!=="23505") throw Error("Upload metadata could not be saved.");
  }
  const result=await supabase.storage.from("rfp-documents").upload(path,file,{contentType:mime,upsert:false});
  if(result.error && String(result.error.statusCode)!=="409" && result.error.error!=="Duplicate" && result.error.message!=="The resource already exists")
    throw Error("Private upload failed. Retry with the same file.");
  if(currentUser()?.id!==owner) throw Error("Account changed. Select the documents again.");
  return id;
}
