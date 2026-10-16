// components/admin/CategoryBadge/CategoryBadge.tsx
import styles from './CategoryBadge.module.scss';

interface Props {
  category: string;
}

export default function CategoryBadge({ category }: Props) {
  return <span className={styles.badge}>{category}</span>;
}
