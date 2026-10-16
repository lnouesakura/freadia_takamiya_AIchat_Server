// app/api/tts/route.ts
import { NextRequest, NextResponse } from 'next/server';

// ═══════════════════════════════════════════════════════════════
// ▼ 数字を日本語読みに変換
// ═══════════════════════════════════════════════════════════════

const ICHIS = ['','いち','に','さん','よん','ご','ろく','なな','はち','きゅう'];

function numToJp(n: number): string {
  if (isNaN(n) || n < 0) return String(n);
  if (n === 0) return 'ゼロ';
  const oku  = Math.floor(n / 100000000);
  const man  = Math.floor((n % 100000000) / 10000);
  const sen  = Math.floor((n % 10000) / 1000);
  const hyak = Math.floor((n % 1000) / 100);
  const ju   = Math.floor((n % 100) / 10);
  const ichi = n % 10;
  let r = '';
  if (oku  > 0) r += numToJp(oku) + 'おく';
  if (man  > 0) r += numToJp(man) + 'まん';
  if (sen  > 0) r += sen === 1 ? 'いっせん' : ICHIS[sen] + 'せん';
  if (hyak > 0) {
    if (hyak === 1) r += 'ひゃく';
    else if (hyak === 2) r += 'にひゃく';
    else if (hyak === 3) r += 'さんびゃく';
    else if (hyak === 4) r += 'よんひゃく';
    else if (hyak === 5) r += 'ごひゃく';
    else if (hyak === 6) r += 'ろっぴゃく';
    else if (hyak === 7) r += 'ななひゃく';
    else if (hyak === 8) r += 'はっぴゃく';
    else if (hyak === 9) r += 'きゅうひゃく';
  }
  if (ju   > 0) r += ju === 1 ? 'じゅう' : ICHIS[ju] + 'じゅう';
  if (ichi > 0) r += ICHIS[ichi];
  return r;
}

function parseNum(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10);
}

function amountToSlowJp(man: number): string {
  if (man >= 10000) {
    const oku = Math.floor(man / 10000);
    const restMan = man % 10000;
    let reading = numToJp(oku) + 'おく';
    if (restMan > 0) {
      const senOfRest = Math.floor(restMan / 1000);
      const restOfRest = restMan % 1000;
      if (senOfRest === 1 && restOfRest === 0) {
        reading += 'いっせんまんえん';
      } else {
        reading += numToJp(restMan) + 'まんえん';
      }
    } else {
      reading += 'えん';
    }
    return reading + '。';
  }
  const sen  = Math.floor(man / 1000);
  const rest = man % 1000;
  let r = '';
  if (sen > 0) {
    if (sen === 1 && rest === 0) {
      r += 'いっせん';
    } else {
      r += (sen === 1 ? 'せん' : numToJp(sen) + 'せん');
    }
  }
  if (rest > 0) r += numToJp(rest);
  return r + 'まんえん';
}

function convertAmounts(text: string): string {
  let result = text;
  result = result.replace(/(\d{1,3}(?:,\d{3})*|\d+)万円/g, (match, numStr) => {
    const man = parseNum(numStr);
    if (isNaN(man) || man <= 0) return match;
    return amountToSlowJp(man);
  });
  result = result.replace(/(\d{1,3}(?:,\d{3})+|\d{4,})円/g, (match, numStr) => {
    const n = parseNum(numStr);
    if (isNaN(n) || n <= 0) return match;
    const man  = Math.floor(n / 10000);
    const rest = n % 10000;
    const sen  = Math.floor(rest / 1000);
    const hyak = rest % 1000;
    let r = '';
    if (man  > 0) r += numToJp(man) + 'まん';
    if (sen  > 0) r += numToJp(sen) + 'せん';
    if (hyak > 0) r += numToJp(hyak);
    return r + ' えん';
  });
  return result;
}

const DIGIT_READINGS: Record<string, string> = {
  '0':'ぜろ','1':'いち','2':'に','3':'さん','4':'よん',
  '5':'ごー','6':'ろく','7':'なな','8':'はち','9':'きゅう',
};

function decimalToJp(dec: string): string {
  return dec.split('').map((d) => DIGIT_READINGS[d] ?? d).join('');
}

function convertSqm(text: string): string {
  return text
    .replace(/(\d+)\.(\d+)㎡/g, (_, int, dec) =>
      numToJp(parseInt(int)) + 'てん' + decimalToJp(dec) + 'へいほうめーとる'
    )
    .replace(/(\d+)㎡/g, (_, int) => numToJp(parseInt(int)) + 'へいほうめーとる');
}

function convertMm(text: string): string {
  return text.replace(/(\d{1,3}(?:,\d{3})*|\d+)mm/gi, (_, numStr) =>
    numToJp(parseNum(numStr)) + 'みりめーとる'
  );
}

const HOUR_READINGS: Record<number, string> = {
  1:'いちじかん', 2:'にじかん', 3:'さんじかん', 4:'よじかん',
  5:'ごじかん', 6:'ろくじかん', 7:'しちじかん', 8:'はちじかん',
  9:'くじかん', 10:'じゅうじかん', 11:'じゅういちじかん',
  12:'じゅうにじかん', 13:'じゅうさんじかん', 14:'じゅうよじかん',
  15:'じゅうごじかん', 16:'じゅうろくじかん', 17:'じゅうしちじかん',
  18:'じゅうはちじかん', 19:'じゅうくじかん', 20:'にじゅうじかん',
  21:'にじゅういちじかん', 22:'にじゅうにじかん', 23:'にじゅうさんじかん',
  24:'にじゅうよじかん',
};

function convertTime(text: string): string {
  return text
    .replace(/(\d+):(\d+)/g, (_, h, m) =>
      numToJp(parseInt(h)) + 'じ' + (parseInt(m) > 0 ? numToJp(parseInt(m)) + 'ふん' : '')
    )
    .replace(/(\d+)時間/g, (_, h) => {
      const n = parseInt(h);
      return HOUR_READINGS[n] ?? numToJp(n) + 'じかん';
    });
}

function convertCounters(text: string): string {
  return text
    .replace(/(\d+)階/g,   (_, n) => numToJp(parseInt(n)) + 'かい')
    .replace(/(\d+)戸/g,   (_, n) => numToJp(parseInt(n)) + 'こ')
    .replace(/(\d+)分/g,   (_, n) => numToJp(parseInt(n)) + 'ふん')
    .replace(/(\d+)室/g,   (_, n) => numToJp(parseInt(n)) + 'しつ')
    .replace(/(\d+)台分/g, (_, n) => numToJp(parseInt(n)) + 'だいぶん')
    .replace(/(\d{4})年/g, (_, n) => numToJp(parseInt(n)) + 'ねん')
    .replace(/(\d+)月/g,   (_, n) => numToJp(parseInt(n)) + 'がつ')
    .replace(/(\d+)LDK/g,  (_, n) => {
      const num = parseInt(n);
      const prefix = num === 1 ? 'わん' : num === 2 ? 'にー' : numToJp(num);
      return prefix + 'えるでぃーけー';
    })
    .replace(/(\d+)円/g,   (_, n) => numToJp(parseInt(n)) + 'えん');
}

function insertBreaks(text: string): string {
  let result = text;
  result = result.replace(/・/g, '、');
  result = result.replace(/。([^\s])/g, '。 $1');
  result = result.replace(/、{2,}/g, '、');
  result = result.replace(/。{2,}/g, '。');
  return result;
}

const READING_MAP: [RegExp, string][] = [
  [/月額/g,           'げつがく'],
  [/24時間/g,         'にじゅうよじかん'],
  [/生活利便性/g,     'せいかつりべんせい'],
  [/利便性/g,         'りべんせい'],
  [/専有面積/g,       'せんゆう めんせき'],
  [/共用施設/g,       'きょうようしせつ'],
  [/修繕積立金/g,     'しゅうぜんつみたてきん'],
  [/修繕積立/g,       'しゅうぜんつみたて'],
  [/修繕/g,           'しゅうぜん'],
  [/積立金/g,         'つみたてきん'],
  [/管理費/g,         'かんりひ'],
  [/管理組合/g,       'かんりくみあい'],
  [/管理形態/g,       'かんりけいたい'],
  [/竣工/g,           'しゅんこう'],
  [/入居/g,           'にゅうきょ'],
  [/総戸数/g,         'そうこすう'],
  [/間取り/g,         'まどり'],
  [/駐車場/g,         'ちゅうしゃじょう'],
  [/駐輪場/g,         'ちゅうりんじょう'],
  [/鉄筋コンクリート造/g, 'てっきんこんくりーとぞう'],
  [/鉄筋コンクリート/g,   'てっきんこんくりーと'],
  [/防犯カメラ/g,     'ぼうはんかめら'],
  [/オートロック/g,   'おーとろっく'],
  [/無垢材/g,         'むくざい'],
  [/食洗機/g,         'しょくせんき'],
  [/浴室乾燥機/g,     'よくしつかんそうき'],
  [/追い焚き/g,       'おいだき'],
  [/天井高/g,         'てんじょうだか'],
  [/宅配ロッカー/g,   'たくはいろっかー'],
  [/宅配ボックス/g,   'たくはいぼっくす'],
  [/アイランドキッチン/g, 'あいらんどきっちん'],
  [/コンシェルジュ/g, 'こんしぇるじゅ'],
  [/ペントハウス/g,   'ぺんとはうす'],
  [/ゲストスイート/g, 'げすとすいーと'],
  [/フィットネス/g,   'ふぃっとねす'],
  [/Low-E/g,          'ローイー'],
  [/ZEH-M/g,          'ぜっちえむ'],
  [/ZEH/g,            'ぜっち'],
  [/ICカード/g,       'あいしーかーど'],
  [/〜/g,             'から'],
  [/％/g,             'パーセント'],
  [/%/g,              'パーセント'],
  [/乗換/g,              'のりかえ'],
  [/天神/g,              'てんじん'],
  [/徒歩/g,              'とほ'],
  [/西鉄/g,              'にしてつ'],

];

function applyReadingMap(text: string): string {
  let result = text;
  for (const [pattern, reading] of READING_MAP) {
    result = result.replace(pattern, reading);
  }
  return result;
}

function cleanText(text: string): string {
  return text
    .replace(/[【】「」『』〔〕\[\]]/g, '')
    .replace(/（/g, '、').replace(/）/g, '、')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n+/g, '、')
    .trim();
}

function processText(text: string): string {
  let r = cleanText(text);
  r = convertAmounts(r);
  r = convertMm(r);
  r = convertSqm(r);
  r = convertTime(r);
  r = convertCounters(r);
  r = applyReadingMap(r);
  r = insertBreaks(r);
  return r;
}

// ═══════════════════════════════════════════════════════════════
// ▼ Fish Audio TTS API
// ═══════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const { text, characterId } = await req.json();
    if (!text?.trim()) return NextResponse.json({ error: 'Text is required' }, { status: 400 });

    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Fish Audio API key not configured' }, { status: 500 });

    const referenceId = characterId === 'ren'
      ? process.env.FISH_AUDIO_VOICE_REN
      : process.env.FISH_AUDIO_VOICE_AOI;

    if (!referenceId) return NextResponse.json({ error: 'Voice ID not configured' }, { status: 500 });

    const processed = processText(text);
    if (!processed) return NextResponse.json({ error: 'No speakable text' }, { status: 400 });

    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'model': 's1',
      },
      body: JSON.stringify({
        text: processed,
        reference_id: referenceId,
        format: 'mp3',
        mp3_bitrate: 64,
        latency: 'balanced',
        normalize: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Fish Audio API error:', error);
      return NextResponse.json({ error: 'TTS API failed' }, { status: 500 });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error('TTS route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}