/**
 * Layout da área da médica: a barra de navegação do painel em todas as telas
 * dela. A `NavMedica` se esconde sozinha na sala de vídeo, então este layout
 * pode envolver tudo sem poluir a consulta em andamento.
 */

import { NavMedica } from "@/components/medica/NavMedica";

export default function LayoutMedica({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavMedica />
      {children}
    </>
  );
}
