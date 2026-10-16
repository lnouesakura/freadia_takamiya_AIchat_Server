// components/admin/AnswerBadge/AnswerBadge.tsx
import styles from './AnswerBadge.module.scss';
import type { AnswerStatus } from '@/lib/analyzeQuestion';

interface Props {
  status: AnswerStatus | boolean; // boolean は旧データの後方互換
}

const STATUS_MAP: Record<AnswerStatus, { label: string; className: string }> = {
  answered:  { label: '回答',   className: 'answered' },
  info:      { label: '情報',   className: 'info' },
  guide:     { label: '要案内',   className: 'guide' },
  consult:   { label: '相談',   className: 'consult' },
  unrelated: { label: '未回答', className: 'unrelated' },
};

export default function AnswerBadge({ status }: Props) {
  // 旧データ（boolean）の後方互換
  const normalized: AnswerStatus =
    typeof status === 'boolean'
      ? status ? 'answered' : 'unrelated'
      : status;

  const { label, className } = STATUS_MAP[normalized] ?? STATUS_MAP['answered'];

  return (
    <span className={`${styles.badge} ${styles[className]}`}>
      {label}
    </span>
  );
}
