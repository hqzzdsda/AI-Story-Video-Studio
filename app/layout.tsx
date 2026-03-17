import Navbar from '@/components/layout/Navbar';
import './globals.css';

export const metadata = {
  title: 'AI Video Studio',
  description: 'AI 驱动的视频生成工作站',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // 1. 将 lang 修改为 zh-CN (简体中文)
    // 2. 添加 translate="no" 属性，告诉现代浏览器不要翻译此页面
    <html lang="zh-CN" translate="no">
      <head>
        {/* 3. 专门针对 Google Chrome 浏览器的防翻译 Meta 标签 */}
        <meta name="google" content="notranslate" />
      </head>
      <body className="bg-gray-50">
        <Navbar />
        {children}
      </body>
    </html>
  );
}