import { createNativeStorageApi } from "../storage/storage-api"

export type AppTheme = "light" | "dark"
export type ThemeState = Readonly<{ theme:AppTheme; status:"loading"|"ready"|"error"; busy:boolean; error:string|null; nativeError:string|null }>
export type ThemeApi = {getPreferences:()=>Promise<unknown>;setPreferences:(patch:{theme:AppTheme})=>Promise<unknown>}
export function readTheme(value:unknown):AppTheme {
  if(!value||typeof value!=="object")throw new Error("Preferencia no disponible")
  const theme=(value as {theme?:unknown}).theme
  if(theme===undefined)return "light"
  if(theme!=="light"&&theme!=="dark")throw new Error("Preferencia incompatible")
  return theme
}
export function applyDocumentTheme(theme:AppTheme){document.documentElement.dataset.theme=theme}
export async function applyNativeTheme(theme:AppTheme){
  const runtime=(window as Window&{__TAURI_INTERNALS__?:{invoke:(command:string,args:Record<string,unknown>)=>Promise<void>}}).__TAURI_INTERNALS__
  if(runtime)await runtime.invoke("set_app_theme",{theme})
}

/** Solo presenta y escribe la preferencia de tema. Nunca ejecuta operaciones
 * fiscales, de consentimiento, sesiones de escritura ni snapshots salariales. */
export function createThemeController({api=createNativeStorageApi(),apply=applyDocumentTheme,native=applyNativeTheme}:{api?:ThemeApi;apply?:(theme:AppTheme)=>void;native?:(theme:AppTheme)=>Promise<void>}={}){
  let state:ThemeState=Object.freeze({theme:"light",status:"loading",busy:false,error:null,nativeError:null})
  let disposed=false,initialized=false,revision=0,nativeRevision=0
  let writes=Promise.resolve(),nativeWrites=Promise.resolve()
  const listeners=new Set<(state:ThemeState)=>void>()
  function publish(patch:Partial<ThemeState>){if(disposed)return;state=Object.freeze({...state,...patch});for(const listener of [...listeners])listener(state)}
  function display(theme:AppTheme){
    if(disposed)return
    apply(theme);publish({theme,nativeError:null})
    const token=++nativeRevision
    nativeWrites=nativeWrites.then(async()=>{if(disposed||token!==nativeRevision)return;try{await native(theme)}catch{if(token===nativeRevision)publish({nativeError:"No se pudo armonizar el marco de Windows. El tema del contenido sigue disponible."})}})
  }
  async function initialize(){
    if(initialized||disposed)return;initialized=true
    const token=++revision;publish({status:"loading",error:null})
    try{const preferences=await api.getPreferences();if(disposed||token!==revision)return;display(readTheme(preferences));publish({status:"ready",busy:false})}
    catch{if(disposed||token!==revision)return;display("light");publish({status:"error",busy:false,error:"No se pudo recuperar el tema local. Se utiliza Claro; puedes seguir calculando."})}
  }
  function setTheme(theme:AppTheme):Promise<void>{
    if(disposed||(theme!=="light"&&theme!=="dark"))return Promise.resolve()
    const token=++revision;display(theme);publish({status:"ready",busy:true,error:null})
    // Serializar evita que dos cambios rápidos terminen persistidos al revés.
    writes=writes.then(async()=>{
      if(disposed)return
      try{const saved=await api.setPreferences({theme});if(readTheme(saved)!==theme)throw new Error("Confirmación incompatible");if(token===revision)publish({status:"ready",busy:false,error:null})}
      catch{if(token!==revision||disposed)return;display("light");publish({status:"error",busy:false,error:"No se pudo guardar el tema en este equipo. Se utiliza Claro; el cálculo y el historial se conservan."})}
    })
    return writes
  }
  return Object.freeze({getState:()=>state,subscribe:(listener:(s:ThemeState)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},initialize,setTheme,
    retry:async()=>{await writes;if(disposed)return;initialized=false;await initialize()},
    dispose:()=>{disposed=true;revision++;nativeRevision++;listeners.clear()},
  })
}
export type ThemeController=ReturnType<typeof createThemeController>
