'use client';

// components/chat/QuickQuestions/QuickQuestions.tsx
// チャット画面に質問候補を並べ、押すとその質問がそのまま送信されます。
//
// 以前はこのファイルに質問を直接書いていたため、
// 変えるたびにコードを触って入れ直す必要がありました。
// いまは管理画面（AI知識設計 → 質問候補）で決めた内容を
// /api/suggestions から受け取って並べます。
//
// 候補は2つのまとまりで届きます。
//   よくあるご質問                   … そのページ向けに決めたもの
//   こんなこともお聞きいただけます   … 直前に聞かれたことと同じ話題のもの
import styles from './QuickQuestions.module.scss';

export type SuggestionSection = {
  label: string;
  questions: string[];
};

interface Props {
  /** 出す候補。空なら何も出しません */
  sections: SuggestionSection[];
  onSelect: (q: string) => void;
  disabled: boolean;
  /** 拡大表示のとき true。ボタンが2列から3列になります */
  wide?: boolean;
  /**
   * 隠すかどうか。
   * 消さずに畳んでいるのは、すっと閉じる動きをつけるためです。
   */
  hidden?: boolean;
}

export default function QuickQuestions({
  sections,
  onSelect,
  disabled,
  wide = false,
  hidden = false,
}: Props) {
  const empty = !sections.some((s) => s.questions.length);

  return (
    <div
      className={`${styles.wrapper} ${hidden || empty ? styles.wrapperHidden : ''}`}
      aria-hidden={hidden || empty}
    >
      {sections.map((section) => (
        section.questions.length > 0 && (
          <div key={section.label} className={styles.section}>
            <p className={styles.label}>{section.label}</p>
            <div className={`${styles.list} ${wide ? styles.listWide : ''}`}>
              {section.questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSelect(q)}
                  disabled={disabled || hidden}
                  tabIndex={hidden ? -1 : 0}
                  className={styles.chip}
                  title={q}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
