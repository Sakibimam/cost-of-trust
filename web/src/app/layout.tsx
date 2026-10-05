import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "800"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "Cost of Trust: price is not the cost of execution",
  description: "A buyer agent prices the counterparty, not just the quote. Live routing against seller track records on Cardano preprod.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
