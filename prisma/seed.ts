// Seed de demonstração (dev). Cria usuários mock, a área COIDS e membros.
// Idempotente: pode rodar múltiplas vezes (upsert por uid / slug).
import { PrismaClient, Papel, Visibilidade } from "@prisma/client";

const prisma = new PrismaClient();

const USUARIOS = [
  { uid: "coids.gestor", nome: "Gestor COIDS", email: "coids.gestor@exemplo.com.br" },
  { uid: "coids.secretaria", nome: "Secretaria COIDS", email: "coids.secretaria@exemplo.com.br" },
  { uid: "outro.area", nome: "Outro Área", email: "outro.area@exemplo.com.br" },
];

async function main() {
  for (const u of USUARIOS) {
    await prisma.usuario.upsert({
      where: { uid: u.uid },
      update: { nome: u.nome, email: u.email },
      create: u,
    });
  }

  const gestor = await prisma.usuario.findUniqueOrThrow({ where: { uid: "coids.gestor" } });
  const secretaria = await prisma.usuario.findUniqueOrThrow({ where: { uid: "coids.secretaria" } });

  const area = await prisma.area.upsert({
    where: { slug: "coids" },
    update: {},
    create: {
      nome: "COIDS",
      slug: "coids",
      descricao: "Gestão do patrimônio de equipamentos da área COIDS.",
      visibilidade: Visibilidade.privada,
      ativo: true,
      criadoPor: gestor.id,
    },
  });

  await prisma.areaMembro.upsert({
    where: { areaId_usuarioId: { areaId: area.id, usuarioId: gestor.id } },
    update: { papel: Papel.admin_area, ativo: true },
    create: { areaId: area.id, usuarioId: gestor.id, papel: Papel.admin_area, adicionadoPor: gestor.id },
  });

  await prisma.areaMembro.upsert({
    where: { areaId_usuarioId: { areaId: area.id, usuarioId: secretaria.id } },
    update: { papel: Papel.secretaria, ativo: true },
    create: {
      areaId: area.id,
      usuarioId: secretaria.id,
      papel: Papel.secretaria,
      adicionadoPor: gestor.id,
    },
  });

  console.log("Seed concluído:");
  console.log("  usuários: " + USUARIOS.map((u) => u.uid).join(", "));
  console.log(`  área: COIDS (id=${area.id}) — admin: coids.gestor, secretaria: coids.secretaria`);
  console.log("  login demo: coids.gestor / mock123 (IPA_MODE=mock)");
}

main()
  .catch((err) => {
    console.error("Falha no seed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
