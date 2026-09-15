import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "YouTube Content Publisher",
    template: "%s · YouTube Content Publisher",
  },
  description:
    "Prepare, review and publish video content to YouTube, with Google Drive as the media store.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT maximum-scale=1: preventing pinch-zoom breaks
  // accessibility for low-vision users (Section 43).
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full antialiased">
        {children}
        <Toaster
          position="top-right"
          richColors
          closeButton
          // Errors stay until dismissed; a publish failure must not vanish
          // before the student has read it.
          toastOptions={{ duration: 6000 }}
        />
      </body>
    </html>
  );
}
