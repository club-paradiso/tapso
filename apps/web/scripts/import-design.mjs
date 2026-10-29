import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function validateSettings(value){
 if(!value||value.version!==1)throw Error('Expected TAPSO settings version 1');
 const result={version:1,copy:{},light:{},dark:{}};
 for(const key of ['headline','description','cta']){const text=value.copy?.[key];if(typeof text!=='string'||!text.trim()||text.length>180||/[<>\u0000-\u0008]/u.test(text))throw Error(`Invalid copy.${key}`);result.copy[key]=text;}
 for(const mode of ['light','dark'])for(const key of ['bg','ink','mint','text-secondary','mist','separator']){const color=value[mode]?.[key];if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw Error(`Invalid ${mode}.${key}`);result[mode][key]=color;}
 const luminance=hex=>{const [r,g,b]=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
 for(const mode of ['light','dark'])for(const text of ['ink','text-secondary']){const a=luminance(result[mode].bg),b=luminance(result[mode][text]);if((Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.5)throw Error(`${mode}.${text} contrast must be at least 4.5:1`);}
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Usage: npm run design:import -- /absolute/path/marketing.json');
 const settings=validateSettings(JSON.parse(await readFile(process.argv[2],'utf8')));
 await writeFile(new URL('../src/design/marketing.json',import.meta.url),JSON.stringify(settings,null,2)+'\n');
 console.log('Validated marketing settings imported. Review diff, test, and open a PR.');
}
