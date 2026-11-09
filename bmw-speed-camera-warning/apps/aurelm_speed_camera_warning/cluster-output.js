'use strict';
const { ClusterRender } = require('./cluster_render_client');
const W=840,H=232,BASE_W=420,BASE_H=116;
const FONT={
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
 'A':['01110','10001','10001','11111','10001','10001','10001'],
 'C':['01111','10000','10000','10000','10000','10000','01111'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],
 'I':['11111','00100','00100','00100','00100','00100','11111'],
 'L':['10000','10000','10000','10000','10000','10000','11111'],
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'R':['11110','10001','10001','11110','10100','10010','10001'],
 ' ':['00000','00000','00000','00000','00000','00000','00000'],
 ':':['00000','00100','00100','00000','00100','00100','00000'],
 '+':['00000','00100','00100','11111','00100','00100','00000']
};
function rgba(r,g,b,a){return [r,g,b,a===undefined?255:a];}
function put(px,x,y,c){if(x<0||y<0||x>=BASE_W||y>=BASE_H)return;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=((y*2+dy)*W+(x*2+dx))*4;px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=c[3];}}
function rect(px,x,y,w,h,c){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)put(px,xx,yy,c);}
function text(px,s,x,y,scale,c){let at=x;String(s).toUpperCase().split('').forEach(ch=>{const g=FONT[ch]||FONT[' '];for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)if(g[yy][xx]==='1')rect(px,at+xx*scale,y+yy*scale,scale,scale,c);at+=6*scale;});}
function makeFrame(e){
 const px=Buffer.alloc(W*H*4),red=e.type==='speeding',white=rgba(245,249,252),muted=rgba(169,190,207),accent=red?rgba(255,75,88):rgba(255,205,74);
 // Keep the image transparent: an opaque canvas hides OEM consumption/cluster data.
 rect(px,0,0,BASE_W,5,accent);
 // camera glyph
 rect(px,34,46,42,25,white);rect(px,43,41,17,7,white);
 for(let y=0;y<15;y++)for(let x=0;x<15;x++){const dx=x-7,dy=y-7;if(dx*dx+dy*dy<=49)put(px,55+x,51+y,rgba(7,15,24));}
 text(px,'CAMERA',108,18,3,white);
 text(px,String(Math.max(0,Math.round(e.distanceM||0))+' M'),108,52,5,accent);
 const limit=Number(e.camera&&e.camera.limit);
 if(Number.isFinite(limit)&&limit>0){rect(px,315,27,84,64,rgba(248,249,250));rect(px,321,33,72,52,rgba(211,44,54));rect(px,326,38,62,42,rgba(255,255,255));text(px,String(limit),338,49,4,rgba(20,29,38));}
 else text(px,'LIMIT N/A',300,52,2,muted);
 if(red)text(px,'SPEED',108,94,2,rgba(255,112,120));
 return px;
}
class CameraClusterOutput{
 constructor(options){
  const o=options||{};this.log=o.log||function(){};this.mode=o.mode||'kombi';this.cr=null;this.layers={};this.current=null;this.hideTimer=null;this.closed=false;
  if(this.mode==='off')return;
  try{
   this.cr=new ClusterRender('aurelm_speed_camera_warning');
   this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);});
   this.cr.on('target',(name,state,holder,reason,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+name+' '+state+(holder?' holder='+holder:'')+(reason?' '+reason:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));
   this.cr.on('layer',(ref,state,reason)=>this.log('CLUSTER_RENDER_LAYER '+ref+' '+state+(reason?' '+reason:'')));
   this.cr.on('refused',(op,ref,reason)=>this.log('CLUSTER_RENDER_REFUSED '+op+' '+reason));
   this.cr.on('disconnected',()=>this.log('CLUSTER_RENDER_DISCONNECTED'));
   this.cr.connect();
  }catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e&&e.message||e));this.cr=null;}
 }
 _makeLayers(){
  if(!this.cr||!this.cr.ready)return;
  const targets=this.mode==='both'?['panel','hud']:[this.mode==='hud'?'hud':'panel'];
  targets.forEach(target=>{
   if(this.layers[target])return;
   const hud=target==='hud';
   const ref=this.cr.image({target,klass:'overlay',z:900,x:hud?20:540,y:hud?135:244,w:hud?760:W,h:hud?210:H,iw:W,ih:H,sampling:'linear',visible:false,opacity:1});
   if(ref){this.layers[target]=ref;this.log('CLUSTER_RENDER_LAYER_CREATED target='+target+' ref='+ref+' x='+(hud?20:540)+' y='+(hud?135:244)+' size='+W+'x'+H+' class=overlay');}else this.log('CLUSTER_RENDER_LAYER_CREATE_FAILED target='+target);
  });
 }
 _draw(e){
  if(!this.cr||!this.cr.ready)return;
  this._makeLayers();const px=makeFrame(e);
  Object.keys(this.layers).forEach(target=>{const ref=this.layers[target];this.cr.pixels(ref,null,px);this.cr.set(ref,{visible:true});});
 }
 show(event){
  if(!event||!event.camera||!this.cr)return;
  this.current={type:event.type,distanceM:event.distanceM,camera:event.camera,speedKmh:event.speedKmh};
  if(this.hideTimer)clearTimeout(this.hideTimer);
  this._draw(this.current);
  // Failsafe: clear stale alerts if GPS stops updating or the vehicle leaves the monitored segment.
  this.hideTimer=setTimeout(()=>this.clear(),45000);
 }
 sync(states){
  if(!this.current)return;
  const state=states&&states[this.current.camera.id];
  // A proximity event may be emitted after its transient state has already been removed.
  // Keep the accepted alert visible; the failsafe timer in show() owns its lifetime.
  if(!state)return;
  const distance=Math.max(0,Math.round(state.distanceM));
  if(Number.isFinite(distance)&&Math.abs(distance-this.current.distanceM)>=8){this.current.distanceM=distance;this._draw(this.current);}
 }
 clear(){
  if(this.hideTimer)clearTimeout(this.hideTimer);this.hideTimer=null;this.current=null;
  if(this.cr)Object.keys(this.layers).forEach(target=>this.cr.set(this.layers[target],{visible:false}));
 }
 setMode(mode){
  mode=String(mode||'kombi');if(['kombi','hud','both','off'].indexOf(mode)<0)return;
  if(mode===this.mode)return;this.clear();if(this.cr)this.cr.close();this.cr=null;this.layers={};this.mode=mode;
  if(mode!=='off'){try{this.cr=new ClusterRender('aurelm_speed_camera_warning');this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);});this.cr.on('target',(n,state,h,r,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+n+' '+state+(h?' holder='+h:'')+(r?' '+r:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));this.cr.on('refused',(o,ref,r)=>this.log('CLUSTER_RENDER_REFUSED '+o+' '+r));this.cr.connect();}catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e));}}
 }
 close(){this.closed=true;this.clear();if(this.cr)this.cr.close();this.cr=null;}
}
module.exports={CameraClusterOutput};
