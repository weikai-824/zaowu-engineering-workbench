import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  title: "尖锋防务-3DPrintHub · 中国3D打印产品设计开发一站式工作站",
  description: "从多模态创意到可编辑、可追溯的3D打印制造工程。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased"><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
