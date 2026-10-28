import { createContext, useContext, useEffect, useState } from 'react';
import config from './marketing.json';
const Theme = createContext({dark:false,toggle:()=>{}});
export const useTheme=()=>useContext(Theme);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [dark,setDark]=useState(false);
 useEffect(()=>{try{const saved=localStorage.getItem('tapso-theme');setDark(saved?saved==='dark':matchMedia('(prefers-color-scheme: dark)').matches);}catch{/* storage optional */}},[]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';const values=dark?config.dark:config.light;for(const [key,value]of Object.entries(values))document.documentElement.style.setProperty(`--${key}`,value);},[dark]);
 return <Theme.Provider value={{dark,toggle:()=>setDark(v=>{try{localStorage.setItem('tapso-theme',v?'light':'dark');}catch{/* optional */}return !v;})}}>{children}</Theme.Provider>;
}
export function ThemeToggle(){const {dark,toggle}=useTheme();return <button className="theme-toggle" onClick={toggle} type="button" aria-label={dark?'라이트 모드로 전환':'다크 모드로 전환'} aria-pressed={dark}>{dark?'☀':'☾'}<span>{dark?'Light':'Dark'}</span></button>;}
