import { Newsreader, Schibsted_Grotesk, Spline_Sans_Mono } from "next/font/google";

export const display = Newsreader({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--deck-display", display: "swap" });
export const body = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--deck-body", display: "swap" });
export const figures = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--deck-fig", display: "swap" });
