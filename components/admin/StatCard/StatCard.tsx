// components/admin/StatCard/StatCard.tsx
import styles from './StatCard.module.scss';

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}

export default function StatCard({ label, value, sub, accent }: Props) {
  return (
    <div className={`${styles.card} ${accent ? styles.cardAccent : ''}`}>
      <p className={styles.label}>{label}</p>
      <p className={`${styles.value} ${accent ? styles.valueAccent : ''}`}>{value}</p>
      {sub && <p className={styles.sub}>{sub}</p>}
    </div>
  );
}
