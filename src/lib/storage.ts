import { prisma } from "./prisma";

// Abstração de storage para fotos (decisão travada: Postgres BLOB no MVP,
// trocável por S3/MinIO no futuro sem reescrever quem consome).
//
// Modelo 1:N (pacote ③-B): um patrimônio pode ter N fotos (máx 10, aplicado
// na rota). "A foto" (capa) = a 1ª posição da galeria — toda leitura de
// "a foto" usa orderBy [{ ordem: "asc" }, { id: "asc" }] (determinístico;
// fotos antigas têm ordem=0 → capa segue sendo a menor id até o 1º reorder).
export interface FotoMetadado {
  id: number;
  tamanho: number;
  contentType: string;
}

export interface FotoBlob {
  data: Uint8Array;
  contentType: string;
}

export interface Storage {
  // Cria uma nova linha de foto (não substitui as existentes).
  append(patrimonioId: number, data: Buffer, contentType: string): Promise<FotoMetadado>;
  // Capa = 1ª posição da galeria (ordem asc, id asc), com BLOB. null se vazio.
  cover(patrimonioId: number): Promise<FotoBlob | null>;
  // BLOB escopado: só retorna se a foto pertence ao patrimônio (fid AND patrimonioId).
  byId(patrimonioId: number, fotoId: number): Promise<FotoBlob | null>;
  // Metadados (SEM BLOB), ordem da galeria (ordem asc, id asc).
  list(patrimonioId: number): Promise<FotoMetadado[]>;
  // Reordenar galeria (drag & drop): ordem = índice no array. Aceita apenas a
  // lista EXATA dos fids deste patrimônio (sem faltas/sobras/duplicatas).
  reordenar(patrimonioId: number, ordem: number[]): Promise<boolean>;
  // Remoção escopada; true se uma linha foi removida, false se inexistente/outra.
  removeById(patrimonioId: number, fotoId: number): Promise<boolean>;
}

export class PostgresBlobStorage implements Storage {
  async append(patrimonioId: number, data: Buffer, contentType: string): Promise<FotoMetadado> {
    const criado = await prisma.patrimonioFoto.create({
      data: {
        patrimonioId,
        data: Uint8Array.from(data),
        contentType,
        tamanho: data.length,
      },
    });
    return { id: criado.id, tamanho: criado.tamanho, contentType: criado.contentType };
  }

  async cover(patrimonioId: number): Promise<FotoBlob | null> {
    const foto = await prisma.patrimonioFoto.findFirst({
      where: { patrimonioId },
      orderBy: [{ ordem: "asc" }, { id: "asc" }],
    });
    if (!foto) return null;
    return { data: foto.data, contentType: foto.contentType };
  }

  async byId(patrimonioId: number, fotoId: number): Promise<FotoBlob | null> {
    const foto = await prisma.patrimonioFoto.findFirst({
      where: { patrimonioId, id: fotoId },
    });
    if (!foto) return null;
    return { data: foto.data, contentType: foto.contentType };
  }

  async list(patrimonioId: number): Promise<FotoMetadado[]> {
    const fotos = await prisma.patrimonioFoto.findMany({
      where: { patrimonioId },
      orderBy: [{ ordem: "asc" }, { id: "asc" }],
      select: { id: true, tamanho: true, contentType: true },
    });
    return fotos.map((f) => ({ id: f.id, tamanho: f.tamanho, contentType: f.contentType }));
  }

  async removeById(patrimonioId: number, fotoId: number): Promise<boolean> {
    const res = await prisma.patrimonioFoto.deleteMany({
      where: { patrimonioId, id: fotoId },
    });
    return res.count > 0;
  }

  async reordenar(patrimonioId: number, ordem: number[]): Promise<boolean> {
    // Valida o conjunto: mesma quantidade, todos os fids pertencem a ESTE
    // patrimônio e sem repetição. Qualquer divergência → false (rota dá 400).
    const atuais = await prisma.patrimonioFoto.findMany({
      where: { patrimonioId },
      select: { id: true },
    });
    if (ordem.length !== atuais.length) return false;
    const validos = new Set(atuais.map((f) => f.id));
    const vistos = new Set<number>();
    for (const fid of ordem) {
      if (!validos.has(fid) || vistos.has(fid)) return false;
      vistos.add(fid);
    }
    // Escopo duplo em cada escrita (id PK + patrimonioId): zero vazamento
    // lateral mesmo que a validação acima falhasse.
    await prisma.$transaction(
      ordem.map((fid, i) =>
        prisma.patrimonioFoto.updateMany({
          where: { id: fid, patrimonioId },
          data: { ordem: i },
        }),
      ),
    );
    return true;
  }
}

export const storage: Storage = new PostgresBlobStorage();
