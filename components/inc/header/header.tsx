'use client';

// components/inc/header/header.tsx
import Link from 'next/link';
import styles from './header.module.scss';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import SideHeader from './sideHeader';
import TopHeader from './topHeader';

type HeaderProps = {
    showSide?: boolean;
    showTop?: boolean;
};

export default function Header({showSide = false, showTop = false}: HeaderProps) {

    return (
        <header className={styles.header}>
          {showSide && <SideHeader />}
          {showTop && <TopHeader />}

            
        </header>
    );
}