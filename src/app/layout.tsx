import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sondar",
  description: "Controle financeiro pessoal/familiar",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full flex flex-col bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
