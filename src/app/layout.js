import SessionGuard from "@/components/SessionGuard";
import "./globals.css";

export const metadata = {
  title: "헥토큐앤엠 근태관리시스템",
  description: "헥토큐앤엠 근태관리시스템의 실시간 출퇴근, 월간 근태, 휴가 및 일정 관리 화면입니다.",
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <title>헥토큐앤엠 근태관리시스템</title>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <SessionGuard />
        {children}
      </body>
    </html>
  );
}
