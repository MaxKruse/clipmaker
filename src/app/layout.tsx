import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipMaker",
  description: "Visual editor for cutting mp4 clips and gifs from local videos",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
