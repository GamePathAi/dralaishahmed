/**
 * Layout da área do paciente: a barra com "Sair" em todas as telas dele. A
 * `NavPaciente` se esconde sozinha na sala de vídeo.
 */

import { NavPaciente } from "@/components/paciente/NavPaciente";

export default function LayoutPaciente({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavPaciente />
      {children}
    </>
  );
}
