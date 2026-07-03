import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ToastProvider, ToastViewport } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Fonts
// Display: Bricolage Grotesque (names/headlines). Body: Geist. Utility: Geist Mono.
// ---------------------------------------------------------------------------

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Matchup — Engineer Guessing Game",
  description:
    "Each week you're paired with a teammate. Answer four questions, guess theirs, and see how well you know each other.",
};

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        <ToastProvider>
          <div className="app-shell">
            <Nav />
            {children}
          </div>
          <ToastViewport />
        </ToastProvider>
      </body>
    </html>
  );
}
