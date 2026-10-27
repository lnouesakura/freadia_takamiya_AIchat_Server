'use client';

// components/chat/QuickQuestions/QuickQuestions.tsx
// チャット画面に「よくあるご質問」を並べ、押すとその質問がそのまま送信されます。
import styles from './QuickQuestions.module.scss';

// ▼ 表示する質問はここを編集してください。
//    label    … ボタンに出る短い文字（長いと2行になって崩れます）
//    question … 実際にAIへ送られる文章。きちんとした一文にしておくと回答の精度が上がります。
//
//    物件情報に載っていないこと（価格など）を並べると「確認します」という返答になるので、
//    答えられる内容を選ぶと、デモとして見栄えがよくなります。
const QUESTIONS: { label: string; question: string }[] = [
  { label: '周辺環境について', question: '周辺環境について教えてください' },
  { label: 'セキュリティは？', question: 'セキュリティはどうなっていますか？' },
  { label: '子育て環境は？', question: '子育て環境について知りたいです' },
  { label: 'キッチンの設備について', question: 'キッチンの設備を教えてください' },
  { label: '駐車場はある？', question: '駐車場はありますか？' },
  { label: '断熱や省エネについて', question: '断熱や省エネ性能について教えてください' },
];

interface Props {
  onSelect: (q: string) => void;
  disabled: boolean;
  /** 拡大表示のとき true。ボタンが2列から3列になります */
  wide?: boolean;
  /**
   * 隠すかどうか。
   * 消さずに畳んでいるのは、すっと閉じる動きをつけるためです。
   */
  hidden?: boolean;
  /** 見出しの文言（既定：よくあるご質問） */
  label?: string;
}

export default function QuickQuestions({
  onSelect,
  disabled,
  wide = false,
  hidden = false,
  label = 'よくあるご質問',
}: Props) {
  return (
    <div className={`${styles.wrapper} ${hidden ? styles.wrapperHidden : ''}`} aria-hidden={hidden}>
      <p className={styles.label}>{label}</p>
      <div className={`${styles.list} ${wide ? styles.listWide : ''}`}>
        {QUESTIONS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onSelect(q.question)}
            disabled={disabled || hidden}
            tabIndex={hidden ? -1 : 0}
            className={styles.chip}
            title={q.question}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
