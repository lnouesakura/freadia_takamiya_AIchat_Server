// lib/historyOrder.ts
// 過去の会話を、画面に出す順（古い順）に並べ替えます。
//
// ■ なぜ専用に要るか
// createdAt だけでは順番が決まりません。
// ご質問と回答は createMany で1つの命令として保存していたため、
// 2件とも createdAt がまったく同じ時刻になっていました。
// 同じ時刻どうしをどちらから返すかはデータベース任せなので、
// ページを開き直すたびに、回答が質問より先に並ぶことがありました。
//
// 保存側は時刻を1ミリ秒ずらすよう直しましたが、
// それ以前に保存されたぶんは同じ時刻のままです。
// ここで決めきることで、古いぶんも正しい順に出ます。

export type HistoryRow = {
  role: string;
  content: string;
  createdAt: Date | string;
  id: string;
};

/** ご質問を先に、回答をあとに */
function rank(role: string): number {
  return role === 'user' ? 0 : 1;
}

/**
 * 古い順に並べ替えます。次の順に見ます。
 *
 *   1. 時刻が早いほう
 *   2. 同じ時刻なら、ご質問（user）が先
 *   3. それでも同じなら id の順
 *      （cuid は先頭が時刻と連番なので、保存した順になります）
 *
 * 元の配列は変更しません。
 */
export function sortOldestFirst<T extends HistoryRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    if (a.role !== b.role) return rank(a.role) - rank(b.role);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
