import {createContext,useContext,useEffect,useState,type ReactNode} from "react"
import {Moon,Sun} from "lucide-react"
import {Button} from "@/components/ui/button"
import {createThemeController,type ThemeController,type ThemeState} from "./theme-controller"

const initial:ThemeState={theme:"light",status:"loading",busy:false,error:null,nativeError:null}
const ThemeContext=createContext<{state:ThemeState;controller:ThemeController|null}>({state:initial,controller:null})
export function ThemeProvider({children,createController=createThemeController}:{children:ReactNode;createController?:()=>ThemeController}){
  const [value,setValue]=useState<{state:ThemeState;controller:ThemeController|null}>({state:initial,controller:null})
  useEffect(()=>{const controller=createController();const unsubscribe=controller.subscribe(state=>setValue({state,controller}));setValue({state:controller.getState(),controller});void controller.initialize();return()=>{unsubscribe();controller.dispose()}},[createController])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
export function ThemeToggleControl({state,disabled=false,onToggle,onRetry}:{state:ThemeState;disabled?:boolean;onToggle?:()=>void;onRetry?:()=>void}){
  const dark=state.theme==="dark",message=state.error??state.nativeError,active=`Tema ${dark?"oscuro":"claro"} activo.`
  return <div className="theme-toggle">
    <Button type="button" variant="secondary" className="theme-indicator" data-theme={state.theme} aria-label={dark?"Activar tema claro":"Activar tema oscuro"} aria-describedby="theme-preference-status" aria-busy={state.busy} disabled={disabled} onClick={onToggle}>
      {dark?<Moon aria-hidden="true"/>:<Sun aria-hidden="true"/>}Tema {dark?"oscuro":"claro"}
    </Button>
    <span id="theme-preference-status" className={message?"theme-preference-notice":"sr-only"} role="status">{message??(state.status==="loading"?"Recuperando preferencia de tema…":state.busy?`${active} Guardando preferencia…`:active)}{message&&<button type="button" onClick={onRetry}>Reintentar</button>}</span>
  </div>
}
export function ThemeToggle(){const{state,controller}=useContext(ThemeContext);return <ThemeToggleControl state={state} disabled={!controller||state.status==="loading"} onToggle={()=>void controller?.setTheme(state.theme==="light"?"dark":"light")} onRetry={()=>void controller?.retry()}/>}
