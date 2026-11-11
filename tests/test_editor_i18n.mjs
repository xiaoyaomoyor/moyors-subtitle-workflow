import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../web/editor-i18n.js',import.meta.url),'utf8'),context);
const {translateText}=context.window.MSWE_I18N;

test('current dynamic UI translations preserve values and literal speaker names',()=>{
  for(const [source,expected] of [
    ['淡入开始 起+0.300 s','Fade-in start Start+0.300 s'],
    ['淡出结束 终−0.000 s','Fade-out end End−0.000 s'],
    ['滑出开始 85%','Slide-out start 85%'],
    ['缩放 100% → 115%','Scale 100% → 115%'],
    ['间隔 0.080 s','Interval 0.080 s'],
    ['关键帧 2，终点前 0.300 s，80','Keyframe 2, Before end 0.300 s, 80'],
    ['其他参数的关键帧：0.500 s','Keyframe on another parameter: 0.500 s'],
    ['水平偏移 (px)','Horizontal offset (px)'],
    ['恢复原地震动默认值','Reset Shake defaults'],
    ['向上 显示名称','向上 Show name'],
    ['全部说话人 着色模式','All speakers Color mode'],
    ['字幕轨道 · 已选 2 条','Subtitle tracks · 2 selected'],
    ['时间','Time'],
    ['6 条字幕','6 cues'],
    ['导入润色稿…','Import polished script…'],
    ['已选 12 条正文','12 texts selected'],
    ['第 8 行：缺少轨道名称','Line 8: Missing track name'],
    ['已导入 12 条草稿，请检查后应用编辑','Staged 12 drafts; review and apply edits'],
    ['锁定 S2','Lock S2'],
  ]){
    assert.equal(translateText(source,'en'),expected);
    assert.equal(translateText(source,'zh'),source);
  }
});
