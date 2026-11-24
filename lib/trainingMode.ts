// lib/trainingMode.ts
//
// 学習モードの設定と、「使ってよいか」の判定です。
//
// ■ 使い方
// チャットのURLに ?training=1 を付けて開くと、学習モードになります。
//   ローカル   … http://localhost:3000/?training=1
//   埋め込み   … 貼り付け側（aichat.php）が ?training=1 を iframe のURLに渡します
// 付けなければ、お客様と同じ通常のチャットです。
//
// ■ 本番に出すとき
// いまは合言葉を確認していません（公開前のテスト環境のため）。
// 本番に出す前に、isTrainingKeyValid() だけを書き換えてください。
// 画面（学習モードにするか）とサーバー（保存を受け付けるか）の両方が
// この関数を通るので、ここ1か所で足ります。
// 例）?training=<合言葉> にして、環境変数 TRAINING_KEY と照合する。

/** 学習モード中に使う識別IDの接頭辞。ログ画面でこの印で見分けます */
export const TRAINING_ID_PREFIX = 'train-';

/** URLに付ける名前。?training=1 */
export const TRAINING_PARAM = 'training';

/**
 * URLに付いた値で、学習モードを使ってよいかを返します。
 * 画面・サーバーの両方から呼ばれます。
 *
 * TODO（本番前）: 合言葉の照合に変えてください。
 */
export function isTrainingKeyValid(value: string | null | undefined): boolean {
  return value === '1';
}

/** 質問文が近いとみなすしきい値（0〜1）。参考資料として広く拾うため低めにしています */
export const MATCH_THRESHOLD = 0.3;

/** 本文の言葉の重なりで拾うときの条件。共有する言葉の数と、発話に占める割合 */
export const BODY_MIN_SHARED = 3;
export const BODY_MIN_RATIO = 0.5;

/** 1回の回答で差し込む学習内容の上限件数 */
export const MATCH_LIMIT = 5;
