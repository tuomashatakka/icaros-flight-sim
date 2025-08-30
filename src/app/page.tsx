"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/levels/procedural');
  }, [router]);

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-background text-foreground">
      <p>Loading Zone Racer...</p>
    </div>
  );
}
