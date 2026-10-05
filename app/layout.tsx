import type { Metadata } from "next";
import "./globals.css";
import { APP_VERSION } from "../lib/directfuel-version";

export const metadata: Metadata = {
  title: "DirectFuel Vixpar",
  description:
    "Gestão online de abastecimentos, medições, acordos e rede de postos Vixpar.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="stylesheet" href={`/directfuel-styles.css?v=${APP_VERSION}`} />
      </head>
      <body>{children}</body>
    </html>
  );
}
