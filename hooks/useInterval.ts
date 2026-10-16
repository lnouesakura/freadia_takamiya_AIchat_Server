// hooks/useInterval.ts
// 管理画面の自動更新（ポーリング）用フック。
// 最新のコールバックを保持しつつ、指定間隔で実行する。delay が null の間は停止。
import { useEffect, useRef } from 'react';

export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// 管理画面共通の自動更新間隔（60秒）
export const ADMIN_REFRESH_MS = 60_000;
