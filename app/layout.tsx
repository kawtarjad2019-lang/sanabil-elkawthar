import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "سنابل الكوثر | مركز الدعم المدرسي",
  description: "منصة إدارة مركز سنابل الكوثر",
  applicationName: "Sanabil Elkawthar",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Sanabil Elkawthar",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16806b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
