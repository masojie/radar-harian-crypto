import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Radar Harian Crypto",
  description: "Pantauan RSI oversold & win-rate sinyal spot Indodax, real-time.",
  openGraph: {
    title: "Radar Harian Crypto",
    description: "Pantauan RSI oversold & win-rate sinyal spot Indodax.",
    locale: "id_ID",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0e0b" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f0" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#konten">
          Lewati ke konten
        </a>
        {children}
      </body>
    </html>
  );
}
