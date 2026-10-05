// src/utils/storage-base.ts

export type StorageItemValue = string | number | boolean | null | object ;

export abstract class StorageBase {
  protected retrieve<Fallback>(raw: string | null, fallback: Fallback): Fallback | null {
    if (raw === null) return fallback ;
    try {
      return JSON.parse(raw) as Fallback ;
    } catch {
      return fallback ;
    }
  }

  protected warn(action: string, key: string, error: unknown) {
    console.warn(`[Storage] Erreur lors de ${action} pour la clé "${key}" :`, error) ;
  }
}

export type AssertNoExtras<T> = [T] extends [never] ? true : false ;