export type PlaybackType = 'music' | 'video' | 'unknown'
export type Track = { title:string;artist:string;album:string;artwork?:string;playbackType:PlaybackType;playbackStatus:'playing'|'paused'|'stopped'|'unknown';position:number;duration:number;canPlayPause:boolean;canPrevious:boolean;canNext:boolean }
export type BridgeMessage =
  | { protocolVersion?:number;type:'media_update';data:Track|null }
  | { protocolVersion?:number;type:'bridge_status';stage:string;sessionFound?:boolean;sourceAppId?:string|null;playbackType?:PlaybackType;details?:string }
  | { protocolVersion?:number;type:'command_result';command:string;success:boolean;error?:{code:string;message:string;exceptionType?:string;hresult?:string} }
  | { protocolVersion?:number;type:'bridge_error';error:{code:string;message:string;exceptionType?:string;hresult?:string} }
export type Settings = { startWithWindows:boolean;alwaysOnTop:boolean;rememberPosition:boolean;showWhenMusicStarts:boolean;hideWhenMusicStops:boolean;hideDelay:number;playbackControls:boolean;themeIntensity:number }
export const defaultSettings:Settings={startWithWindows:false,alwaysOnTop:true,rememberPosition:true,showWhenMusicStarts:true,hideWhenMusicStops:true,hideDelay:1800,playbackControls:true,themeIntensity:60}
export function isMusic(track:unknown):track is Track{return !!track&&typeof track==='object'&&(track as Track).playbackType==='music'}
export function parseBridgeMessage(line:string):BridgeMessage|null{
  try {
    const value=JSON.parse(line)
    if(!value||typeof value!=='object'||Array.isArray(value)||(value.protocolVersion!==undefined&&value.protocolVersion!==1))return null
    const version=value.protocolVersion===undefined?{}:{protocolVersion:1}
    if(value.type==='media_update'){
      if(value.data===null)return{...version,type:'media_update',data:null}
      const d=value.data
      if(!d||typeof d!=='object'||Array.isArray(d)||typeof d.title!=='string'||typeof d.artist!=='string'||typeof d.album!=='string'||!['music','video','unknown'].includes(d.playbackType)||!['playing','paused','stopped','unknown'].includes(d.playbackStatus)||typeof d.position!=='number'||!Number.isFinite(d.position)||d.position<0||typeof d.duration!=='number'||!Number.isFinite(d.duration)||d.duration<0||['canPlayPause','canPrevious','canNext'].some(key=>typeof d[key]!=='boolean')||('artwork'in d&&d.artwork!==null&&typeof d.artwork!=='string'))return null
      const track={...d}
      if(track.artwork===null)delete track.artwork
      return{...version,type:'media_update',data:track as Track}
    }
    if(value.type==='bridge_status'&&typeof value.stage==='string'&&['sessionFound','sourceAppId','playbackType','details'].every(key=>value[key]===undefined||({sessionFound:typeof value.sessionFound==='boolean'||value.sessionFound===null,sourceAppId:value.sourceAppId===null||typeof value.sourceAppId==='string',playbackType:['music','video','unknown'].includes(value.playbackType),details:typeof value.details==='string'} as Record<string,boolean>)[key]))return{...version,type:'bridge_status',stage:value.stage,...(typeof value.sessionFound!=='boolean'?{}:{sessionFound:value.sessionFound}),...(value.sourceAppId===undefined?{}:{sourceAppId:value.sourceAppId}),...(value.playbackType===undefined?{}:{playbackType:value.playbackType}),...(value.details===undefined?{}:{details:value.details})}
    if(value.type==='command_result'&&typeof value.command==='string'&&typeof value.success==='boolean'&&(value.error===undefined||(value.error&&typeof value.error.code==='string'&&typeof value.error.message==='string')))return{...version,type:'command_result',command:value.command,success:value.success,...(value.error===undefined?{}:{error:value.error})}
    if(value.type==='bridge_error'&&value.error&&typeof value.error.code==='string'&&typeof value.error.message==='string')return{...version,type:'bridge_error',error:value.error}
    return null
  } catch{return null}
}
export function parseBridgeLine(line:string):{type:string;data:Track|null}|null{const message=parseBridgeMessage(line);return message?.type==='media_update'?{type:message.type,data:message.data}:null}
export function normalizeSettings(value:unknown):Partial<Settings>|null{if(!value||typeof value!=='object'||Array.isArray(value))return null;const input=value as Record<string,unknown>,out:Partial<Settings>={};for(const key of ['startWithWindows','alwaysOnTop','rememberPosition','showWhenMusicStarts','hideWhenMusicStops','playbackControls'] as const)if(key in input){if(typeof input[key]!=='boolean')return null;out[key]=input[key]}if('hideDelay'in input){if(typeof input.hideDelay!=='number'||!Number.isFinite(input.hideDelay)||input.hideDelay<0||input.hideDelay>30000)return null;out.hideDelay=input.hideDelay}if('themeIntensity'in input){if(typeof input.themeIntensity!=='number'||!Number.isFinite(input.themeIntensity)||input.themeIntensity<0||input.themeIntensity>100)return null;out.themeIntensity=input.themeIntensity}return Object.keys(input).length>0&&Object.keys(input).every(key=>key in defaultSettings)?out:null}
export function clampWindowPosition(x:number,y:number,area:{x:number;y:number;width:number;height:number},width:number,height:number){return{x:Math.max(area.x,Math.min(x,area.x+area.width-width)),y:Math.max(area.y,Math.min(y,area.y+area.height-height))}}
export function updatePersistedSettings(read:()=>Settings,write:(value:Settings)=>void,value:unknown):Settings|null{const patch=normalizeSettings(value);if(!patch)return null;const next={...read(),...patch};write(next);return next}
export function persistWindowPosition(write:(x:number,y:number)=>void,x:number,y:number){write(x,y)}
export function progressPercent(position:number,duration:number){return duration>0?Math.max(0,Math.min(100,position/duration*100)):0}
