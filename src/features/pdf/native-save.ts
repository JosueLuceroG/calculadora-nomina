export type PdfSaveResult={status:"cancelled"}|{status:"saved";path:string;bytes:number;sha256:string}
async function save(command:"save_pdf_probe"|"save_pdf_report",bytes:Uint8Array,suggestedName:string):Promise<PdfSaveResult>{
 const runtime=(window as Window&{__TAURI_INTERNALS__?:{invoke:<T>(command:string,args:Record<string,unknown>)=>Promise<T>}}).__TAURI_INTERNALS__
 if(!runtime)throw new Error("El diálogo de guardado requiere la aplicación Windows.")
 try{return await runtime.invoke<PdfSaveResult>(command,{bytes:Array.from(bytes),suggestedName})}
 catch(e){const error=e as {code?:string;message?:string};throw new Error(error.message??"No se pudo guardar el PDF de prueba.")}
}
export const savePdfProbe=(bytes:Uint8Array,suggestedName:string)=>save("save_pdf_probe",bytes,suggestedName)
export const savePdfReport=(bytes:Uint8Array,suggestedName:string)=>save("save_pdf_report",bytes,suggestedName)
