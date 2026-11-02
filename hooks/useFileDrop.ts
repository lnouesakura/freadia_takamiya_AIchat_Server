'use client';

// hooks/useFileDrop.ts
// ファイルをドラッグして置ける枠の、共通のしくみです。
//
// ■ なぜ共通にしたか
// 情報登録・バックアップ・画像・設計データの4か所に同じ枠があり、
// それぞれが同じ書き方をしていました。下に書いた不具合も4か所にありました。
//
// ■ 直した不具合
// もとは onDragOver で「重なった」、onDragLeave で「離れた」にしていました。
// ところが onDragLeave は、枠の中のボタンや文字の上へ移ったときにも出ます。
// ブラウザから見れば「枠から出てボタンに入った」ためです。
// そのせいで色が付いたり消えたりを繰り返し、ほとんど点滅していました。
//
// ここでは出入りの回数を数えて、本当に枠の外へ出たときだけ消します。
// 中のボタンへ移っても、数が0にならないので消えません。
import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

export type FileDrop = {
  /** いま枠の上にドラッグしているか。枠の見た目を変えるのに使います */
  over: boolean;
  /** 枠に付けるハンドラ一式 */
  handlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
};

export function useFileDrop(onFile: (file: File) => void): FileDrop {
  const [over, setOver] = useState(false);
  /** 枠とその中の要素に、いくつ入っているか */
  const depth = useRef(0);

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  }, []);

  // ここで止めないと、ブラウザがファイルを開いてしまいます
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setOver(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return { over, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
