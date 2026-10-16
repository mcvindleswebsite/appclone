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
    title: "mcvindle",
  },
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary", title, description },
  icons: [
    { rel: "apple-touch-icon", sizes: "180x180", url: "/sites/ipod/apple-touch-icon.png" },
    { rel: "icon", type: "image/png", sizes: "32x32", url: "/sites/ipod/favicon-32x32.png" },
    { rel: "icon", type: "image/png", sizes: "16x16", url: "/sites/ipod/favicon-16x16.png" },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
