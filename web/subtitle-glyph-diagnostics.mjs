// Collect only libass's final fallback failure, never its normal font search.
// Bundled into the worker; no filesystem paths or full renderer logs reach UI.
export class SubtitleGlyphDiagnostics {
  entries=new Map();
  more=false;
  reset(){this.entries.clear();this.more=false;}
  record(log){
    const match=String(log).slice(0,8192).match(/fontselect:\s*failed to find any fallback(?: with glyph 0x([0-9a-f]{1,8}))?\s+for font:\s*\(([^\r\n]{0,512}?),\s*\d+,\s*\d+\)/i);
    if(!match)return;
    const family=match[2].replace(/\p{C}/gu,'').trim().slice(0,100)||'当前字体';
    const code=match[1]?parseInt(match[1],16):0;
    const key=JSON.stringify([family,code]);
    if(this.entries.has(key))return;
    if(this.entries.size>=8){this.more=true;return;}
    let glyph='';
    if(code){
      const char=code<=0x10ffff?String.fromCodePoint(code):'';
      if(char&&!/[\p{C}\s]/u.test(char))glyph=`「${char}」`;
      glyph+=` U+${code.toString(16).toUpperCase().padStart(4,'0')}`;
    }
    this.entries.set(key,`字体「${family}」${glyph}`);
  }
  summary(){
    return this.entries.size?'字幕字体回退后仍缺字：'+[...this.entries.values()].join('；')+(this.more?'；另有其他缺字':'')+'。请安装包含这些字符的字体或调整字幕字体后重试。':'';
  }
}
