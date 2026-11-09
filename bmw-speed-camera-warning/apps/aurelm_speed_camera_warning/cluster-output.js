'use strict';
const { ClusterRender } = require('./cluster_render_client');
const W=420,H=116,S=4,IW=W*S,IH=H*S;
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
 'N':['10001','11001','10101','10011','10001','10001','10001'],
 'P':['11110','10001','10001','11110','10000','10000','10000'],
 'S':['01111','10000','10000','01110','00001','00001','11110'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],
 'D':['11110','10001','10001','10001','10001','10001','11110'],
 '/':['00001','00010','00010','00100','01000','01000','10000'],
 'R':['11110','10001','10001','11110','10100','10010','10001'],
 ' ':['00000','00000','00000','00000','00000','00000','00000'],
 ':':['00000','00100','00100','00000','00100','00100','00000'],
 '+':['00000','00100','00100','11111','00100','00100','00000']
};
function rgba(r,g,b,a){return [r,g,b,a===undefined?255:a];}
function put(px,x,y,c){if(x<0||y<0||x>=IW||y>=IH)return;const i=(y*IW+x)*4;px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=c[3];}
function rect(px,x,y,w,h,c){for(let yy=y*S;yy<(y+h)*S;yy++)for(let xx=x*S;xx<(x+w)*S;xx++)put(px,xx,yy,c);}
function circle(px,cx,cy,r,c){const rr=r*S,ccx=cx*S,ccy=cy*S;for(let y=Math.floor(ccy-rr-1);y<=Math.ceil(ccy+rr+1);y++)for(let x=Math.floor(ccx-rr-1);x<=Math.ceil(ccx+rr+1);x++){const dx=x+0.5-ccx,dy=y+0.5-ccy,d=Math.sqrt(dx*dx+dy*dy),coverage=Math.max(0,Math.min(1,rr+0.5-d));if(coverage>0){const a=Math.round(c[3]*coverage);put(px,x,y,[c[0],c[1],c[2],a]);}}}
function text(px,s,x,y,scale,c){
 let at=x;
 // Draw each bitmap-font cell as a softly antialiased rounded stroke instead
 // of a hard square. The 4x backing buffer preserves edge coverage when the
 // cluster renderer scales the image to its 420x116 destination.
 const radius=Math.max(0.28,Math.min(0.42,scale*0.085));
 String(s).toUpperCase().split('').forEach(ch=>{
  const g=FONT[ch]||FONT[' '];
  for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)if(g[yy][xx]==='1'){
   const x0=(at+xx*scale)*S,y0=(y+yy*scale)*S,w=scale*S,h=scale*S,r=radius*S;
   for(let py=Math.floor(y0);py<Math.ceil(y0+h);py++)for(let pxX=Math.floor(x0);pxX<Math.ceil(x0+w);pxX++){
    const qx=Math.max(x0+r,Math.min(pxX+0.5,x0+w-r));
    const qy=Math.max(y0+r,Math.min(py+0.5,y0+h-r));
    const dx=pxX+0.5-qx,dy=py+0.5-qy;
    const coverage=Math.max(0,Math.min(1,r+0.5-Math.sqrt(dx*dx+dy*dy)));
    if(coverage>0){const i=(py*IW+pxX)*4,a=Math.round(c[3]*coverage);px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=Math.max(px[i+3],a);}
   }
  }
  at+=6*scale;
 });
}
function makeFrame(e){
 const px=Buffer.alloc(IW*IH*4),red=e.type==='speeding',white=rgba(245,249,252),muted=rgba(169,190,207),accent=red?rgba(255,75,88):rgba(255,205,74);
 // Keep the image transparent: an opaque canvas hides OEM consumption/cluster data.
 rect(px,0,0,W,5,accent);
 // camera glyph
 rect(px,34,46,42,25,white);rect(px,43,41,17,7,white);
 for(let y=0;y<15;y++)for(let x=0;x<15;x++){const dx=x-7,dy=y-7;if(dx*dx+dy*dy<=49)rect(px,55+x,51+y,1,1,rgba(7,15,24));}
 text(px,'CAMERA',108,18,3,white);
 text(px,String(Math.max(0,Math.round(e.distanceM||0))+' M'),108,52,5,accent);
 const limit=Number(e.camera&&e.camera.limit);
 if(Number.isFinite(limit)&&limit>0){circle(px,357,59,32,rgba(211,44,54));circle(px,357,59,26,rgba(255,255,255));const label=String(limit);const scale=label.length<=2?4:label.length===3?3:2;const width=label.length*6*scale-scale;const tx=357-width/2;const ty=59-(7*scale)/2;text(px,label,tx,ty,scale,rgba(20,29,38));}
 else text(px,'LIMIT N/A',300,52,2,muted);
 if(red)text(px,'SPEED',108,94,2,rgba(255,112,120));
 return px;
}
class CameraClusterOutput{
 constructor(options){
  const o=options||{};this.log=o.log||function(){};this.mode=o.mode||'kombi';this.cr=null;this.layers={};this.current=null;this.hideTimer=null;this.missingTimer=null;this.closed=false;
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
   const ref=this.cr.image({target,klass:'overlay',z:900,x:hud?190:750,y:hud?182:302,w:W,h:H,iw:IW,ih:IH,sampling:'bilinear',visible:false,opacity:1});
   if(ref){this.layers[target]=ref;this.log('CLUSTER_RENDER_LAYER_CREATED target='+target+' ref='+ref+' x='+(hud?190:750)+' y='+(hud?182:302)+' size='+W+'x'+H+' class=overlay');}else this.log('CLUSTER_RENDER_LAYER_CREATE_FAILED target='+target);
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
  if(this.missingTimer)clearTimeout(this.missingTimer);this.missingTimer=null;
  this._draw(this.current);
  // Failsafe: clear stale alerts if GPS stops updating or the vehicle leaves the monitored segment.
  this.hideTimer=setTimeout(()=>this.clear(),45000);
 }
 sync(states){
  if(!this.current)return;
  // The manual output test uses a synthetic camera id that is intentionally
  // absent from the live road-guidance state map. Let its own 10s timer clear it.
  if(this.current.camera&&String(this.current.camera.id)==='camera-output-test'){
   this.log('CLUSTER_OUTPUT_SYNC_TEST_SKIP');
   return;
  }
  const state=states&&states[this.current.camera.id];
  if(!state){
   // GPS/state-machine updates can briefly omit a camera. Do not blank HUD/KOMBI
   // on the first missing sample; allow a short grace period for the next fix.
   if(!this.missingTimer){
    this.log('CLUSTER_OUTPUT_SYNC_MISSING camera='+this.current.camera.id+' grace_ms=10000');
    this.missingTimer=setTimeout(()=>{
     this.missingTimer=null;
     if(this.current)this.clear();
    },10000);
   }
   return;
  }
  if(this.missingTimer){clearTimeout(this.missingTimer);this.missingTimer=null;this.log('CLUSTER_OUTPUT_SYNC_RETURNED camera='+this.current.camera.id);}
  const distance=Math.max(0,Math.round(state.distanceM));
  if(Number.isFinite(distance)&&Math.abs(distance-this.current.distanceM)>=8){this.current.distanceM=distance;this._draw(this.current);}
 }
 clear(){
  if(this.hideTimer)clearTimeout(this.hideTimer);this.hideTimer=null;
  if(this.missingTimer)clearTimeout(this.missingTimer);this.missingTimer=null;this.current=null;
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
