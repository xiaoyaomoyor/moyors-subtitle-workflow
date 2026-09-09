// MSW's independent Chinese/English adapter. Dependencies live in the optional resource pack.
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(root, 'package.json'));
const Pinyin = require('tiny-pinyin');
const PinyinToKana = require('pinyin-to-kana');
const ChineseNumber = require('number-to-chinese-words');
const {englishToKana} = await import(pathToFileURL(join(root, 'english/en_rules.mjs')));
const {load} = await import(pathToFileURL(join(root, 'node_modules/aquestalk.js/dist/index.js')));
const mapping = new PinyinToKana(readFileSync(join(root, 'node_modules/pinyin-to-kana/mapping.tsv'), 'utf8'));

function convert(text, language) {
  const englishNumbers = language === 'English' || (language === 'Auto' && !/\p{Script=Han}/u.test(text));
  const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const chinese = word => Pinyin.parse(word).map(item => item.type === 2 ? mapping.pinyinToKana(item.target) : item.source).join('');
  let result = text.normalize('NFKC').replace(/[A-Za-z]+|\p{Script=Han}+|-?\d+(?:\.\d+)?/gu, word => {
    if (/^[A-Za-z]+$/.test(word)) return englishToKana(word);
    if (/^-?\d/.test(word)) {
      if (englishNumbers) return [...word].map(char => englishToKana(char === '.' ? 'point' : char === '-' ? 'minus' : digits[Number(char)])).join(',');
      // Preserve long identifiers digit by digit rather than rounding an unsafe JS number.
      word = word.replace(/\d{16,}/g, number => [...number].map(digit => ChineseNumber.toWords(Number(digit))).join(''));
      if (/^-?\d+(?:\.\d+)?$/.test(word)) word = ChineseNumber.toWords(Number(word));
    }
    return chinese(word);
  });
  result = result.replace(/[\u3041-\u3096]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60));
  result = result.replace(/[\s\p{P}\p{S}]+/gu, ',').replace(/,+/g, ',').replace(/^,|,$/g, '');
  // Katakana long vowel is a modifier letter, not punctuation.
  if (!result || /[^\u30A1-\u30FAー,]/u.test(result)) throw new Error('读音包含无法转换的字符，请填写读音修正或拆分字幕');
  return result;
}

function splitKana(text) {
  const result = [];
  while (text.length) {
    let end = Math.min(180, text.length);
    if (end < text.length) {
      const pause = text.lastIndexOf(',', end);
      if (pause >= 60) end = pause + 1;
      while (end < text.length && /[ァィゥェォャュョッー]/.test(text[end])) end++;
    }
    const part = text.slice(0, end).replace(/^,+|,+$/g, '');
    if (part) result.push(part);
    text = text.slice(end);
  }
  return result;
}

function pcmParts(bytes) {
  const data = Buffer.from(bytes);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('引擎未返回 WAV 音频');
  let format, pcm;
  for (let offset = 12; offset + 8 <= data.length;) {
    const id = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4);
    if (offset + 8 + size > data.length) throw new Error('引擎音频不完整');
    if (id === 'fmt ') format = data.subarray(offset + 8, offset + 8 + size);
    if (id === 'data') pcm = data.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  if (!format || format.length < 16 || format.readUInt16LE(0) !== 1 || !pcm?.length) throw new Error('引擎音频格式无效');
  return {format, pcm};
}

function joinWav(parts) {
  if (!parts.length || parts.some(part => !part.format.equals(parts[0].format))) throw new Error('引擎音频格式不一致');
  const format = parts[0].format, pcm = Buffer.concat(parts.map(part => part.pcm));
  if (pcm.length > 32 * 1024 * 1024 - 128) throw new Error('音频超过单条 32 MiB 限制，请拆分字幕');
  const header = Buffer.alloc(28 + format.length);
  header.write('RIFF'); header.writeUInt32LE(20 + format.length + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(format.length, 16); format.copy(header, 20);
  header.write('data', 20 + format.length); header.writeUInt32LE(pcm.length, 24 + format.length);
  return Buffer.concat([header, pcm]);
}

let engine;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 16000) throw new Error('合成输入过长');
  }
  const {text, recipe} = JSON.parse(input);
  if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('合成文本须为 1–600 字符');
  if (!['f1', 'f2', 'm1', 'm2', 'dvd', 'imd1', 'jgr', 'r1'].includes(recipe.voice)
      || !Number.isInteger(recipe.speed) || recipe.speed < 50 || recipe.speed > 300) throw new Error('音色或语速无效');
  const spoken = convert(text, recipe.language_type);
  engine = await load(recipe.voice);
  const parts = splitKana(spoken).map(part => pcmParts(engine.run(part, recipe.speed)));
  writeFileSync(output, joinWav(parts), {flag: 'wx'});
  process.stdout.write(JSON.stringify({ok: true, spoken_text: spoken}));
} catch (error) {
  // Native stack traces can contain installation paths; keep the protocol small and predictable.
  const message = /^[\u4e00-\u9fff]/u.test(String(error.message)) ? String(error.message).slice(0, 250) : '油库里无法合成此读音，请尝试读音修正；持续失败时重新检测资源';
  process.stdout.write(JSON.stringify({ok: false, error: message}));
} finally {
  if (engine) await engine.destroy();
}
