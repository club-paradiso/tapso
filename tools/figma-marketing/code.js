// Local, network-free development plugin. Export only explicitly named marketing settings.
figma.showUI(__html__, {width:420,height:300});
figma.ui.onmessage = async (message) => {
 if(message.type !== 'export')return;
 try{
  const collections=await figma.variables.getLocalVariableCollectionsAsync();
  const c=collections.find(c=>c.name==='TAPSO Web PR');
  if(!c)throw Error('TAPSO Web PR collection not found');
  const variables=await Promise.all(c.variableIds.map(id=>figma.variables.getVariableByIdAsync(id)));
  const output={version:1,copy:{},light:{},dark:{}};
  for(const v of variables){if(!v)continue;for(const mode of c.modes){const val=v.valuesByMode[mode.modeId];if(v.name.startsWith('copy/')){if(mode.name==='Light')output.copy[v.name.slice(5)]=val;}else if(v.name.startsWith('color/')){if(!val||typeof val!=='object'||!('r' in val))throw Error('Color aliases must be resolved before export');output[mode.name.toLowerCase()][v.name.slice(6)]='#'+[val.r,val.g,val.b].map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');}}}
  figma.ui.postMessage({type:'settings',json:JSON.stringify(output,null,2)});
 }catch(error){figma.ui.postMessage({type:'error',message:String(error)});}
};
