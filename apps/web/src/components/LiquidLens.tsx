import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision mediump float;
varying vec2 uv; uniform sampler2D scene; uniform vec2 resolution; uniform vec2 imageSize; uniform vec2 pointer; uniform float time; uniform float dark;
vec3 photo(vec2 p){vec2 ratio=resolution/imageSize;vec2 s=ratio/max(ratio.x,ratio.y);return texture2D(scene,(p-.5)*s+.5).rgb;}
void main(){
 vec2 p=uv; float aspect=resolution.x/resolution.y; vec2 center=vec2(.72,.51)+pointer*.025;
 if(aspect<.9)center=vec2(.5,.66)+pointer*.015;
 vec2 q=(p-center)*vec2(aspect,1.); float radius=aspect<.9?.255:.30;
 float a=atan(q.y,q.x);float wobble=sin(a*3.+time*.55)*.009+sin(a*5.-time*.4)*.004;
 float d=length(q)/(radius+wobble);float mask=1.-smoothstep(.985,1.015,d);
 vec3 blur=vec3(0.);float weights=0.;for(int x=-2;x<=2;x++){for(int y=-2;y<=2;y++){float w=exp(-float(x*x+y*y)*.35);blur+=photo(p+vec2(float(x),float(y))*.004)*w;weights+=w;}}blur/=weights;
 float z=sqrt(max(0.,1.-d*d));vec2 bend=q*(.34*z-.09)/vec2(aspect,1.);vec3 lens=photo(p-bend);
 float rim=pow(clamp(d,0.,1.),14.);float shine=pow(max(0.,dot(normalize(vec3(q/radius,z)),normalize(vec3(-.6,.8,1.)))),24.);
 lens+=rim*vec3(.24,.48,.52)+shine*.65;
 float shade=dark*.45;vec3 base=mix(blur,vec3(.02,.06,.08),shade);base=mix(base,vec3(1.),(1.-dark)*.12);
 vec3 color=mix(base,lens,mask);gl_FragColor=vec4(color,1.);
}`;

/** Decorative refraction. HTML content and controls remain usable without WebGL. */
export function LiquidLens({dark,paused}:{dark:boolean;paused:boolean}) {
 const canvas=useRef<HTMLCanvasElement>(null);const reduced=useReducedMotion();const [ready,setReady]=useState(false);
 useEffect(()=>{
  const c=canvas.current;if(!c)return;const gl=c.getContext('webgl',{alpha:false,antialias:false});if(!gl)return;
  let frame=0,disposed=false;const shaders:WebGLShader[]=[];
  function compile(type:number,source:string){const s=gl!.createShader(type);if(!s)throw Error('shader');shaders.push(s);gl!.shaderSource(s,source);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS))throw Error('compile');return s;}
  let program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null,texture:WebGLTexture|null=null;let observer:ResizeObserver|undefined;
  const pointer={x:0,y:0},target={x:0,y:0};let visible=true;let intersection:IntersectionObserver|undefined;
  const move=(e:PointerEvent)=>{const r=c.getBoundingClientRect();target.x=(e.clientX-r.left)/r.width-.5;target.y=.5-(e.clientY-r.top)/r.height;};
  const leave=()=>{target.x=0;target.y=0;};const parent=c.parentElement!;
  try{
   program=gl.createProgram();if(!program)throw Error('program');gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('link');gl.useProgram(program);
   buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
   texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
   const loc=(n:string)=>gl.getUniformLocation(program!,n);const u={res:loc('resolution'),img:loc('imageSize'),pointer:loc('pointer'),time:loc('time'),dark:loc('dark')};
   const img=new Image();img.onload=()=>{if(disposed)return;gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);gl.uniform2f(u.img,img.naturalWidth,img.naturalHeight);setReady(true);draw(0);};img.src=dark?'/media/jeju-sunset.webp':'/media/jeju-coast.webp';
   function draw(t:number){if(disposed)return;if(visible&&!document.hidden){const r=c!.getBoundingClientRect();const scale=Math.min(window.devicePixelRatio||1,1.5);const w=Math.round(r.width*scale),h=Math.round(r.height*scale);if(c!.width!==w||c!.height!==h){c!.width=w;c!.height=h;gl!.viewport(0,0,w,h);}pointer.x+=(target.x-pointer.x)*.055;pointer.y+=(target.y-pointer.y)*.055;gl!.uniform2f(u.res,w,h);gl!.uniform2f(u.pointer,reduced?0:pointer.x,reduced?0:pointer.y);gl!.uniform1f(u.time,reduced||paused?0:t*.001);gl!.uniform1f(u.dark,dark?1:0);gl!.drawArrays(gl!.TRIANGLES,0,6);}if(!reduced&&!paused)frame=requestAnimationFrame(draw);}
   observer=new ResizeObserver(()=>{if(reduced||paused)draw(0);});observer.observe(c);intersection=new IntersectionObserver(([e])=>{visible=e.isIntersecting;});intersection.observe(c);
   if(!reduced&&!paused){parent.addEventListener('pointermove',move);parent.addEventListener('pointerleave',leave);}
  }catch{setReady(false);}
  return()=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();intersection?.disconnect();parent.removeEventListener('pointermove',move);parent.removeEventListener('pointerleave',leave);shaders.forEach(s=>gl.deleteShader(s));gl.deleteBuffer(buffer);gl.deleteTexture(texture);gl.deleteProgram(program);};
 },[dark,reduced,paused]);
 return <canvas ref={canvas} className={`liquid-canvas${ready?' is-ready':''}`} aria-hidden="true"/>;
}
