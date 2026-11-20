import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Nunito_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Avenir is the brand face; Nunito Sans is its closest free relative and
// covers every machine that doesn't ship Avenir.
const avenirFallback = Nunito_Sans({
  variable: "--font-avenir-fallback",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gear Inventory Scheduler",
  description:
    "One shared booking calendar for every team that uses the gear — pick a free slot, and taken slots stay locked.",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${avenirFallback.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
