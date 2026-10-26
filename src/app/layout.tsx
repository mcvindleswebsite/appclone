import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Vincent Velasco (@mcvindle)";
const description =
  "Vincent Velasco's portfolio, built as an iPod Classic: favorite songs, games, and links to Instagram and TikTok.";

export const metadata: Metadata = {
  title,
  description,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vindle",
  },
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary", title, description },
  // Vindle tile: SVG for browser tabs (squircle), a full-bleed PNG for the iOS home screen
  // (iOS rounds the corners itself), and app/favicon.ico for everything else.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // Black browser chrome / status bar to match the edge-to-edge background.
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
