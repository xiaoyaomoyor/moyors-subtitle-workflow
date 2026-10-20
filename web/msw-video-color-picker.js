// Samples a paused video frame, never the composited subtitle/UI screenshot.
(function(global) {
  'use strict';
  let active=null;
  function cancel(){active?.();}
  function pick({video,stage,rect,valid=()=>true,onPick,onError}) {
    cancel();
    if(video.readyState<2||!video.videoWidth||!video.videoHeight||video.seeking){onError('请先载入视频并暂停在要取色的画面');return;}
    const previous=document.activeElement,source=video.currentSrc,time=video.currentTime;
    video.pause();
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    try{ctx.drawImage(video,0,0);ctx.getImageData(0,0,1,1);}catch(_){onError('无法读取此视频的画面，请使用本机编辑器打开本地视频');return;}
    const overlay=document.createElement('div');overlay.className='msw-video-color-picker';overlay.tabIndex=0;
    overlay.setAttribute('role','group');overlay.setAttribute('aria-label','视频取色，点击画面选择颜色，Esc 取消');
    const hint=document.createElement('span');hint.className='msw-video-color-hint';hint.textContent='取色中：点击画面，Esc 取消';
    const sample=document.createElement('span');sample.className='msw-video-color-sample';sample.hidden=true;
    overlay.append(canvas,hint,sample);stage.append(overlay);
    let frame=0,closed=false;
    function finish() {
      if(closed)return;closed=true;cancelAnimationFrame(frame);overlay.remove();
      global.removeEventListener('keydown',keydown,true);video.removeEventListener('play',finish);
      if(active===finish)active=null;
      if(previous?.isConnected)previous.focus({preventScroll:true});
      canvas.width=canvas.height=0;
    }
    function keydown(event){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish();}}
    function update() {
      if(!valid()||video.currentSrc!==source||Math.abs(video.currentTime-time)>.001||!stage.isConnected){finish();return;}
      const b=rect();
      if(!b.width||!b.height){finish();return;}
      Object.assign(overlay.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});
      frame=requestAnimationFrame(update);
    }
    function color(event) {
      const b=canvas.getBoundingClientRect(),x=Math.min(canvas.width-1,Math.max(0,Math.floor((event.clientX-b.left)/b.width*canvas.width)));
      const y=Math.min(canvas.height-1,Math.max(0,Math.floor((event.clientY-b.top)/b.height*canvas.height)));
      const pixel=ctx.getImageData(x,y,1,1).data;
      return '#'+[...pixel].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');
    }
    overlay.onpointerdown=event=>{event.preventDefault();event.stopPropagation();};
    overlay.onpointermove=event=>{
      event.stopPropagation();const value=color(event),b=overlay.getBoundingClientRect();
      sample.hidden=false;sample.textContent=value.toUpperCase();sample.style.setProperty('--sample-color',value);
      sample.style.left=Math.max(0,Math.min(b.width-112,event.clientX-b.left+14))+'px';
      sample.style.top=Math.max(0,Math.min(b.height-30,event.clientY-b.top+14))+'px';
    };
    overlay.onclick=event=>{
      event.preventDefault();event.stopPropagation();
      if(!valid()){finish();return;}
      const value=color(event);finish();onPick(value);
    };
    overlay.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();finish();};
    video.addEventListener('play',finish);global.addEventListener('keydown',keydown,true);
    active=finish;update();if(!closed)overlay.focus({preventScroll:true});
  }
  global.MSWVideoColorPicker=Object.freeze({pick,cancel,get active(){return !!active;}});
})(window);
