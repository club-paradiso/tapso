import { createContext, useContext, useEffect, useState } from 'react';
import config from './marketing.json';
const Theme = createContext({dark:false,toggle:()=>{}});
export const useTheme=()=>useContext(Theme);
/** Writes the theme to <html>. index.html already set data-theme before the first paint. */
function apply(dark:boolean){document.documentElement.dataset.theme=dark?'dark':'light';const values=dark?config.dark:config.light;for(const [key,value]of Object.entries(values))document.documentElement.style.setProperty(`--${key}`,value);}
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [dark,setDark]=useState(false);
 // Read the choice index.html made rather than recomputing it, so the page never flashes the other theme.
 useEffect(()=>{const initial=document.documentElement.dataset.theme==='dark';apply(initial);setDark(initial);},[]);
 const toggle=()=>setDark(v=>{const next=!v;try{localStorage.setItem('tapso-theme',next?'dark':'light');}catch{/* optional */}apply(next);return next;});
 return <Theme.Provider value={{dark,toggle}}>{children}</Theme.Provider>;
}
export function ThemeToggle(){const {dark,toggle}=useTheme();return <button className="theme-toggle" onClick={toggle} type="button" aria-label={dark?'라이트 모드로 전환':'다크 모드로 전환'} aria-pressed={dark}>{dark?'☀':'☾'}<span>{dark?'Light':'Dark'}</span></button>;}
