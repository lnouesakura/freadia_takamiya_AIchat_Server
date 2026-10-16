'use client';

// components/chat/QuickQuestions/QuickQuestions.tsx
// チャット画面に「よくあるご質問」を並べ、押すとその文言がそのまま送信されます。
import styles from './QuickQuestions.module.scss';

// ▼ 表示する質問はここを編集してください。
//    ボタンに書いた文章が、そのままお客様の発言としてAIに送られます。
//    物件情報に載っていないこと（価格など）を並べると「確認します」という返答になるので、
//    答えられる内容を選ぶと、デモとして見栄えがよくなります。
const QUESTIONS = [
  '駅からの距離とアクセスを教えてください',
  '周辺のスーパーやコンビニは？',
  '子育て環境について知りたいです',
  'セキュリティはどうなっていますか？',
  'キッチンの設備を教えてください',
  '駐車場はありますか？',
  '断熱や省エネ性能について',
];

interface Props {
  onSelect: (q: string) => void;
  disabled: boolean;
  /** 見出しの文言（既定：よくあるご質問） */
  label?: string;
}

export default function QuickQuestions({ onSelect, disabled, label = 'よくあるご質問' }: Props) {
  return (
    <div className={styles.wrapper}>
      <p className={styles.label}>{label}</p>
      <div className={styles.list}>
        {QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSelect(q)}
            disabled={disabled}
            className={styles.chip}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
