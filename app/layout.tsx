import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Trading Analysis",
  description: "Real-time Market Intelligence Platform",
  // Prevent browser/extension auto-translate from mutating SSR HTML (causes hydration mismatches).
  other: {
    google: "notranslate",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0D1117" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="antialiased bg-gray-950 notranslate" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
