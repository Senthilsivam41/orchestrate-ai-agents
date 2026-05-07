import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripMind — AI Trip Planner",
  description: "Plan your perfect family trip with LangGraph-powered AI orchestration. Get personalized itineraries, restaurant picks, homestays, and activities.",
  keywords: "trip planner, AI travel, LangGraph, family trip, itinerary generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
