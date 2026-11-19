import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CBT 週間活動記録システム',
  description: '行動活性化・気分トラッキング（認知行動療法 週間活動記録シート）',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
