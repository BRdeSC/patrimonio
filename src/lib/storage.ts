import { prisma } from "./prisma";

// Abstração de storage para fotos (decisão travada: Postgres BLOB no MVP,
// trocável por S3/MinIO no futuro sem reescrever quem consome).
export interface StoredObject {
  id: number;
  tamanho: number;
  contentType: string;
}

export interface Storage {
  save(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^patrimonio:(\d+)$/;

export class PostgresBlobStorage implements Storage {
  // key = "patrimonio:<id>" — 1 foto por patrimônio no MVP (substitui a anterior).
  private patrimonioId(key: string): number {
    const match = KEY_PATTERN.exec(key);
    if (!match) throw new Error(`Chave de storage inválida: ${key}`);
    return Number(match[1]);
  }

  async save(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const patrimonioId = this.patrimonioId(key);
    const existente = await prisma.patrimonioFoto.findFirst({
      where: { patrimonioId },
    });
    if (existente) {
      const atualizado = await prisma.patrimonioFoto.update({
        where: { id: existente.id },
        data: { data: Uint8Array.from(data), contentType, tamanho: data.length },
      });
      return {
        id: atualizado.id,
        tamanho: atualizado.tamanho,
        contentType: atualizado.contentType,
      };
    }
    const criado = await prisma.patrimonioFoto.create({
      data: { patrimonioId, data: Uint8Array.from(data), contentType, tamanho: data.length },
    });
    return { id: criado.id, tamanho: criado.tamanho, contentType: criado.contentType };
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    const patrimonioId = this.patrimonioId(key);
    const foto = await prisma.patrimonioFoto.findFirst({
      where: { patrimonioId },
    });
    if (!foto) return null;
    return { data: foto.data, contentType: foto.contentType };
  }

  async delete(key: string): Promise<void> {
    const patrimonioId = this.patrimonioId(key);
    await prisma.patrimonioFoto.deleteMany({ where: { patrimonioId } });
  }
}

export const storage: Storage = new PostgresBlobStorage();
