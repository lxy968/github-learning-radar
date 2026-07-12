import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = getSiteUrl();

  return {
    metadataBase: siteUrl ?? undefined,
    alternates: siteUrl ? { canonical: "/" } : undefined,
    applicationName: "GitHub 学习雷达",
    title: {
      default: "GitHub 学习雷达",
      template: "%s | GitHub 学习雷达"
    },
    description: "把值得学习的 GitHub 开源项目转化为可执行、可验证的具体学习方案。",
    keywords: ["GitHub", "开源学习", "项目推荐", "学习路线", "Mini 复刻"],
    openGraph: {
      type: "website",
      locale: "zh_CN",
      title: "GitHub 学习雷达",
      description: "从开源项目发现到具体学习步骤，把 GitHub 仓库变成可执行的学习计划。",
      siteName: "GitHub 学习雷达",
      url: siteUrl ? "/" : undefined
    },
    twitter: {
      card: "summary",
      title: "GitHub 学习雷达",
      description: "把 GitHub 仓库转化为可执行的具体学习方案。"
    }
  };
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
