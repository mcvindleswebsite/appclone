import type { Metadata } from "next";

import { LyricsApp } from "@/components/sites/lyrics/LyricsApp";

export const metadata: Metadata = {
  title: "Vindle Parodies",
  description: "Song parodies by Vincent Velasco (@mcvindle), synced to the original tracks.",
};

export default function LyricsPage() {
  return <LyricsApp />;
}
