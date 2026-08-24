import type { Metadata } from "next";
import "./globals.css";
import "./icons.css";
export const metadata: Metadata = { title: "saiufofoca", description: "Compartilhe sua tela e converse com seus amigos." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
