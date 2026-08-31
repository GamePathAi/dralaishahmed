import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Dra. Laís Caroline Hahmed",
    template: "%s | Dra. Laís Caroline Hahmed",
  },
  description:
    "Plataforma de agendamento e teleconsulta da Dra. Laís Caroline Hahmed — CRM-MS 16563.",
  // A plataforma inteira fica fora de índice de busca. Ao contrário do site
  // institucional, aqui não há nada que deva aparecer no Google — e URLs de
  // consulta indexadas seriam um problema, não uma conveniência.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0c433c",
  // Sem `maximumScale`: bloquear zoom quebra a leitura de quem precisa ampliar,
  // e numa plataforma de saúde essa é justamente parte do público.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      {/*
        `suppressHydrationWarning` aqui é deliberado e tem escopo mínimo.

        Extensões de navegador escrevem atributos no <body> ANTES de o React
        hidratar — ColorZilla (`cz-shortcut-listen`), Grammarly
        (`data-gr-ext-installed`), gerenciadores de senha, tradutores. Nada
        disso vem do servidor: o HTML entregue é `<body>` puro. É o navegador
        do visitante mexendo no DOM, e não temos como impedir.

        Sem isto, qualquer usuário com uma dessas extensões vê erro de
        hydration no console — não só quem desenvolve.

        O que a flag cobre: SÓ os atributos e o texto DESTE elemento. Os filhos
        continuam sendo verificados normalmente, então um mismatch de verdade
        dentro da aplicação continua aparecendo.

        Condição para isto continuar correto: o <body> não pode ganhar
        atributo calculado no cliente (classe de tema, locale, `data-` dinâmico).
        Se algum dia precisar, remova esta flag — senão o bug some em silêncio.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
