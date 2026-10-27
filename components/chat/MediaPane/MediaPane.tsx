'use client';

// components/chat/MediaPane/MediaPane.tsx
// 拡大表示のとき、画面の左半分に出る画像の枠です。
// Figma「F656_フリーディア大楠」コーディング用（node 1027:270 / 1027:285）に合わせています。
//
// AIの回答に画像が含まれていたときだけ出ます。含まれていなければ、
// 会話欄が中央に寄った表示（node 1027:302）になります。
import { ChatImage } from '@/lib/chatMedia';
import styles from './MediaPane.module.scss';

interface Props {
  images: ChatImage[];
}

export default function MediaPane({ images }: Props) {
  if (images.length === 0) return null;

  return (
    <div className={styles.pane}>
      {images.map((img) => (
        <figure key={img.url} className={styles.figure}>
          {/* 物件画像は外部URLのこともあるため、next/image ではなく img を使っています */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={img.caption || ''} className={styles.image} />
          {img.caption && <figcaption className={styles.caption}>{img.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
