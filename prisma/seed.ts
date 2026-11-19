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
    update: { papel: Papel.OWNER, ativo: true },
    create: { areaId: area.id, usuarioId: gestor.id, papel: Papel.OWNER, adicionadoPor: gestor.id },
  });

  await prisma.areaMembro.upsert({
    where: { areaId_usuarioId: { areaId: area.id, usuarioId: secretaria.id } },
    update: { papel: Papel.OPERATOR, ativo: true },
    create: {
      areaId: area.id,
      usuarioId: secretaria.id,
      papel: Papel.OPERATOR,
      adicionadoPor: gestor.id,
    },
  });

  // Patrimônios de exemplo (idempotente por areaId+numero). Sem BLOB no seed.
  const PATRIMONIOS = [
    {
      numero: "COIDS-0001",
      descricao: "Notebook Dell Latitude",
      marca: "Dell",
      modelo: "Latitude 5440",
      serie: "SN-NB-0001",
      responsavel: "Gestor COIDS",
      detentor: "Ana Souza",
      localizacao: "COIDS — Sala 12",
    },
    {
      numero: "COIDS-0002",
      descricao: "Projetor Epson PowerLite (sem detentor)",
      marca: "Epson",
      modelo: "PowerLite X49",
      serie: "SN-PR-0002",
      responsavel: "Secretaria COIDS",
      detentor: null,
      localizacao: "COIDS — Auditório",
    },
    {
      numero: "COIDS-0003",
      descricao: "Impressora HP LaserJet (sem localização)",
      marca: "HP",
      modelo: "LaserJet M404",
      serie: "SN-IM-0003",
      responsavel: "Secretaria COIDS",
      detentor: "Carlos Lima",
      localizacao: null,
    },
  ];
  for (const p of PATRIMONIOS) {
    await prisma.patrimonio.upsert({
      where: { areaId_numero: { areaId: area.id, numero: p.numero } },
      update: {},
      create: { areaId: area.id, criadoPor: gestor.id, atualizadoPor: gestor.id, ...p },
    });
  }

  console.log("Seed concluído:");
  console.log("  usuários: " + USUARIOS.map((u) => u.uid).join(", "));
  console.log(`  área: COIDS (id=${area.id}) — owner: coids.gestor, operator: coids.secretaria`);
  console.log(`  patrimônios: ${PATRIMONIOS.map((p) => p.numero).join(", ")}`);
  console.log("  login demo: coids.gestor / mock123 (IPA_MODE=mock)");
}

main()
  .catch((err) => {
    console.error("Falha no seed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
