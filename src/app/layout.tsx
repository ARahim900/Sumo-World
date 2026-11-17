import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Sumo World — After dark', description: 'A playable neon city. Walk, drive and explore Sumo World.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
