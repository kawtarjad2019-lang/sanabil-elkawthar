import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "سنابل الكوثر | مركز الدعم المدرسي",
  description: "منصة إدارة مركز سنابل الكوثر",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
